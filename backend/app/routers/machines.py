from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import httpx
import asyncio
import logging
from datetime import datetime, timedelta, date as dt

router = APIRouter()

# ------------------- External API URLs -------------------
MACHINE_URL = "https://srcapiv2.aams.io/AAMS/AI/Machine"
BEARING_URL = "https://srcapiv2.aams.io/AAMS/AI/BearingLocation"
DATA_URL = "https://srcapiv2.aams.io/AAMS/AI/Data"
HEADERS = {'Content-Type': 'application/json'}

# ------------------- Shared HTTP Client with Connection Pooling -------------------
_http_client = None

def get_http_client():
    """Get or create a shared HTTP client with connection pooling"""
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(100.0, connect=10.0),
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=100),
            http2=False  # Disable HTTP/2 to avoid compatibility issues
        )
    return _http_client

# ------------------- Helper: Generate Dates -------------------
def generate_dates(req_date: str) -> List[str]:
    dates = []
    try:
        if "to" in req_date:
            start_str, end_str = [d.strip() for d in req_date.split("to")]
            start_date = datetime.strptime(start_str, "%Y-%m-%d")
            end_date = datetime.strptime(end_str, "%Y-%m-%d")
            while start_date <= end_date:
                dates.append(start_date.strftime("%Y-%m-%d"))
                start_date += timedelta(days=1)
        elif len(req_date) == 7:
            start_date = datetime.strptime(req_date + "-01", "%Y-%m-%d")
            for i in range(31):
                d = start_date + timedelta(days=i)
                if d.month != start_date.month:
                    break
                dates.append(d.strftime("%Y-%m-%d"))
        elif "W" in req_date:
            year, week = req_date.split("-W")
            first_day = datetime.strptime(f"{year}-W{week}-1", "%Y-W%W-%w")
            for i in range(7):
                d = first_day + timedelta(days=i)
                dates.append(d.strftime("%Y-%m-%d"))
        else:
            datetime.strptime(req_date, "%Y-%m-%d")
            dates = [req_date]
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid date format. Use YYYY-MM-DD, YYYY-MM-DD to YYYY-MM-DD, YYYY-MM, or YYYY-Wxx"
        )
    return dates

# ------------------- Helper: Convert MongoDB Objects to JSON-serializable -------------------
def make_json_serializable(obj):
    """
    Recursively convert MongoDB ObjectIds and other non-JSON-serializable objects
    to JSON-serializable types (strings, etc.)
    """
    if obj is None:
        return None
    
    # Handle ObjectId
    try:
        from bson.objectid import ObjectId
        if isinstance(obj, ObjectId):
            return str(obj)
    except ImportError:
        pass
    
    # Handle datetime objects
    if isinstance(obj, datetime):
        # Convert to ISO format string
        return obj.isoformat() if obj else None
    
    # Handle dictionaries
    if isinstance(obj, dict):
        return {key: make_json_serializable(value) for key, value in obj.items()}
    
    # Handle lists
    if isinstance(obj, list):
        return [make_json_serializable(item) for item in obj]
    
    # Handle other types that might cause issues
    if isinstance(obj, (int, float, str, bool)):
        return obj
    
    # For any other type, try to convert to string
    try:
        return str(obj)
    except Exception:
        return None

# ------------------- Request Models -------------------
class MachineRequest(BaseModel):
    date: Optional[str] = None
    customerId: Optional[str] = None
    areaId: Optional[str] = None
    machineType: Optional[str] = None

class MachineDetailRequest(BaseModel):
    date: Optional[str] = None

class BearingDataRequest(BaseModel):
    date: Optional[str] = None
    axis: Optional[str] = "V-Axis"
    data_type: Optional[str] = "OFFLINE"
    analytics_type: Optional[str] = "MF"

# ------------------- 1️⃣ Machines (GET + POST) -------------------
@router.get("/machines")
@router.post("/machines")
async def get_machines(
    request_body: Optional[MachineRequest] = None,
    date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    customerId: Optional[str] = Query(None),
    areaId: Optional[str] = Query(None),
    subAreaId: Optional[str] = Query(None),
    machineType: Optional[str] = Query(None),
    statusId: Optional[str] = Query(None),
    statusName: Optional[str] = Query(None),
    status: Optional[str] = Query(None),  # 👈 added
    technologyId: Optional[str] = Query(None),
    name: Optional[str] = Query(None)
):
    try:
        # ---------------- Determine date(s) ----------------
        if request_body:
            req_date = request_body.date or dt.today().strftime("%Y-%m-%d")
            customerId = request_body.customerId or customerId
            areaId = request_body.areaId or areaId
            machineType = request_body.machineType or machineType
        elif date_from and date_to:
            req_date = f"{date_from} to {date_to}"
        else:
            req_date = date or dt.today().strftime("%Y-%m-%d")

        date_list = generate_dates(req_date)
        all_machines = []

        # ---------------- Fetch from external API in parallel ----------------
        async def fetch_machines_for_date(date_str):
            """Fetch machines for a single date"""
            try:
                # Use shared client for better performance
                client = get_http_client()
                payload = {"date": date_str}
                response = await client.post(MACHINE_URL, headers=HEADERS, json=payload)
                
                if response.status_code == 200:
                    try:
                        data = response.json()
                        # Handle list response
                        if isinstance(data, list):
                            return data
                        # Handle dict response with machines array
                        if isinstance(data, dict):
                            if "machines" in data:
                                return data.get("machines", [])
                            if "data" in data and isinstance(data.get("data"), list):
                                return data.get("data", [])
                        return []
                    except Exception:
                        return []
                else:
                    # Non-200 status code
                    return []
            except Exception:
                # Return empty list on error to not break other parallel requests
                return []
        
        # Fetch all dates in parallel instead of sequentially
        if len(date_list) > 1:
            # Use parallel requests for multiple dates
            try:
                tasks = [fetch_machines_for_date(d) for d in date_list]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for result in results:
                    if isinstance(result, list):
                        all_machines.extend(result)
                    elif isinstance(result, Exception):
                        # Continue on individual failures
                        pass
            except Exception:
                # Fallback to sequential if parallel fails
                for d in date_list:
                    result = await fetch_machines_for_date(d)
                    if isinstance(result, list):
                        all_machines.extend(result)
        else:
            # Single date - sequential request
            result = await fetch_machines_for_date(date_list[0])
            if isinstance(result, list):
                all_machines.extend(result)

        # ---------------- Apply Filters (optimized single pass) ----------------
        # If status is provided but statusName is not, use status for statusName filtering
        effective_statusName = statusName or status
        
        filters = {
            "customerId": customerId,
            "areaId": areaId,
            "subAreaId": subAreaId,
            "machineType": machineType,
            "statusId": statusId,
            "statusName": effective_statusName,
            "technologyId": technologyId,
            "name": name,
        }

        # Apply all filters in a single pass for better performance
        # Only filter if at least one filter has a non-empty value
        has_filters = any(value for value in filters.values() if value)
        
        if has_filters:
            filtered_machines = []
            for m in all_machines:
                # Check all filters
                match = True
                for key, value in filters.items():
                    if value:  # Only check if filter has a value
                        m_value = str(m.get(key, "")).lower()
                        filter_value = str(value).lower()
                        if m_value != filter_value:
                            match = False
                            break
                
                # Also check status/statusName fields if status filter is applied
                if match and effective_statusName:
                    m_status = str(m.get("status", "")).lower()
                    m_statusName = str(m.get("statusName", "")).lower()
                    status_lower = str(effective_statusName).lower()
                    # Match if either status or statusName matches
                    if m_status != status_lower and m_statusName != status_lower:
                        match = False
                
                if match:
                    filtered_machines.append(m)
            
            all_machines = filtered_machines

        # ---------------- Optional: Filter by date range ----------------
        if date_from and date_to:
            try:
                # Parse start date (beginning of day)
                start = datetime.strptime(date_from, "%Y-%m-%d")
                # Parse end date (end of day - 23:59:59.999)
                end = datetime.strptime(date_to, "%Y-%m-%d")
                end = end.replace(hour=23, minute=59, second=59, microsecond=999999)
                
                filtered_by_date = []
                for m in all_machines:
                    if "dataUpdatedTime" in m and m["dataUpdatedTime"]:
                        try:
                            # Handle different datetime formats
                            machine_time_str = m["dataUpdatedTime"]
                            # Try parsing with fromisoformat first (handles ISO format with/without timezone)
                            try:
                                machine_time = datetime.fromisoformat(machine_time_str.replace('Z', '+00:00'))
                            except (ValueError, AttributeError):
                                # Fallback: try parsing as YYYY-MM-DD or other formats
                                try:
                                    # If it's just a date string
                                    if len(machine_time_str) == 10:
                                        machine_time = datetime.strptime(machine_time_str, "%Y-%m-%d")
                                    else:
                                        # Try parsing with strptime for other formats
                                        machine_time = datetime.strptime(machine_time_str.split('T')[0], "%Y-%m-%d")
                                except (ValueError, AttributeError):
                                    continue
                            
                            # Extract just the date part for comparison if needed
                            # Compare full datetime if available, otherwise compare dates
                            if start <= machine_time <= end:
                                filtered_by_date.append(m)
                        except (ValueError, AttributeError, TypeError):
                            # Skip machines with invalid date format
                            continue
                
                all_machines = filtered_by_date
            except Exception as e:
                # Log error but don't break - continue with unfiltered results
                logging.warning(f"Error filtering by date range: {e}")
                pass

        # Ensure all required fields are present for every machine
        required_fields = [
            ("customerId", "N/A"),
            ("statusName", "N/A"),
            ("areaId", "N/A"),
            ("type", "N/A"),
            ("machineType", "N/A"),
            ("dataUpdatedTime", "N/A"),
            ("name", ""),
        ]
        for m in all_machines:
            for field, default in required_fields:
                if field not in m or m[field] in [None, ""]:
                    m[field] = default
        
        # Convert MongoDB ObjectIds and other non-serializable objects to JSON-serializable format
        machines_serialized = make_json_serializable(all_machines)
        
        # Response
        return {
            "totalCount": len(machines_serialized),
            "machines": machines_serialized
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ------------------- 2️⃣ Machine Details + Bearings (GET + POST) -------------------
@router.get("/machines/{machine_id}")
@router.post("/machines/{machine_id}")
async def get_machine_detail(
    machine_id: str,
):
    """
    Fetch a specific machine and its bearings (no date required).
    """
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            # Step 1: Fetch all machines from external API
            res = await client.post(BEARING_URL, headers=HEADERS, json={"machineId": machine_id})
            if res.status_code != 200:
                logging.error(f"Failed to fetch machine list: {res.status_code} - {res.text}")
                raise HTTPException(status_code=res.status_code, detail=f"Failed to fetch machine list: {res.text}")

            try:
                machines = res.json()
            except Exception as json_err:
                logging.error(f"Error parsing machine list JSON: {json_err}")
                raise HTTPException(status_code=500, detail="Malformed response from external API")

            if not machines or not isinstance(machines, list):
                logging.error(f"Unexpected API response format: {machines}")
                raise HTTPException(status_code=500, detail="Unexpected API response format (expected list)")

            # Step 2: Find matching machine by ID
            machine = next(
                (m for m in machines if str(m.get("_id")) == machine_id or str(m.get("machineId")) == machine_id),
                None
            )
            if not machine:
                logging.error(f"Machine with ID {machine_id} not found in API response")
                raise HTTPException(status_code=404, detail=f"Machine with ID {machine_id} not found")

            # Step 3: Fetch bearings for that machine
            res_bearing = await client.post(BEARING_URL, headers=HEADERS, json={"machineId": machine_id})
            if res_bearing.status_code != 200:
                logging.error(f"Failed to fetch bearings: {res_bearing.status_code} - {res_bearing.text}")
                raise HTTPException(status_code=res_bearing.status_code, detail=f"Failed to fetch bearings: {res_bearing.text}")

            try:
                bearings = res_bearing.json()
            except Exception as json_err:
                logging.error(f"Error parsing bearings JSON: {json_err}")
                bearings = []

            if not isinstance(bearings, list):
                logging.warning(f"Bearings response not a list: {bearings}")
                bearings = []

            # Add dummy FFT data if not provided
            for b in bearings:
                b.setdefault("fftData", [{"frequency": f, "amplitude": 1.0} for f in range(1, 11)])

            # Ensure all expected fields are present
            machine["customerId"] = machine.get("customerId") or "N/A"
            machine["areaId"] = machine.get("areaId") or "N/A"
            machine["type"] = machine.get("type") or "N/A"
            machine["dataUpdatedTime"] = machine.get("dataUpdatedTime") or "N/A"

            machine["bearings"] = bearings

            # Convert MongoDB ObjectIds and other non-serializable objects to JSON-serializable format
            machine_serialized = make_json_serializable(machine)

            return {"machine": machine_serialized}

    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"Failed to fetch machine {machine_id}")
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


# ------------------- 3️⃣ Bearing Data (GET + POST) -------------------
@router.get("/machines/data/{machine_id}/{bearing_id}")
@router.post("/machines/data/{machine_id}/{bearing_id}")
async def get_machine_bearing_data(
    machine_id: str,
    bearing_id: str,
    request_body: Optional[BearingDataRequest] = None,
    date: Optional[str] = Query(None),
    axis: Optional[str] = Query("V-Axis"),
    data_type: Optional[str] = Query("OFFLINE"),
    analytics_type: Optional[str] = Query("MF")
):
    try:
        req_date = request_body.date if request_body else date or dt.today().strftime("%Y-%m-%d")
        axis = request_body.axis if request_body else axis
        data_type = request_body.data_type if request_body else data_type
        analytics_type = request_body.analytics_type if request_body else analytics_type

        logging.info(f"Fetching bearing {bearing_id} of machine {machine_id} for dates: {req_date}")
        date_list = generate_dates(req_date)
        all_data = []

        async with httpx.AsyncClient(timeout=20) as client:
            for _ in date_list:
                # Build payload with static and dynamic fields
                # Use data_type parameter (ONLINE or OFFLINE) based on machine type
                effective_data_type = request_body.data_type if request_body and getattr(request_body, "data_type", None) else data_type
                effective_analytics_type = request_body.analytics_type if request_body and getattr(request_body, "analytics_type", None) else analytics_type
                effective_axis = request_body.axis if request_body and getattr(request_body, "axis", None) else axis
                
                payload = {
                    "machineId": request_body.machineId if request_body and getattr(request_body, "machineId", None) else machine_id,
                    "type": effective_data_type,  # This will be "ONLINE" or "OFFLINE"
                    "bearingLocationId": request_body.bearingLocationId if request_body and getattr(request_body, "bearingLocationId", None) else bearing_id,
                    "Analytics_Types": effective_analytics_type or "MF",
                    "Axis_Id": effective_axis or "V-Axis"
                }
                logging.info(f"Fetching bearing data with type: {effective_data_type}, analytics: {effective_analytics_type}, axis: {effective_axis}")
                logging.info(f"POSTing to external API with payload: {payload}")
                response = await client.post(DATA_URL, headers=HEADERS, json=payload)
                if response.status_code != 200:
                    logging.error(f"External API error: {response.status_code} - {response.text}")
                    continue
                data = response.json()
                all_data.append(data)

        if not all_data:
            raise HTTPException(status_code=404, detail="No data found for this bearing")

        merged = all_data[0]
        if "rawData" in merged:
            merged["rowdata"] = merged["rawData"]

        # Convert MongoDB ObjectIds and other non-serializable objects to JSON-serializable format
        merged_serialized = make_json_serializable(merged)

        return {"totalDays": len(all_data), "data": merged_serialized}

    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"Failed to fetch bearing data {bearing_id}")
        raise HTTPException(status_code=500, detail=str(e))
