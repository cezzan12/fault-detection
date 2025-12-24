from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import httpx
import asyncio
import logging
from datetime import datetime, timedelta, date as dt

# Import FFT analysis service
try:
    from app.services.fft_analysis import perform_complete_analysis
except ImportError:
    try:
        from services.fft_analysis import perform_complete_analysis
    except ImportError:
        perform_complete_analysis = None

# Support both absolute and relative imports
try:
    from app.database import get_database
except ImportError:
    try:
        from database import get_database
    except ImportError:
        # Fallback if database not available
        def get_database():
            return None

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


# ------------------- Helper: Fetch from MongoDB -------------------
async def fetch_machines_from_mongodb(date_list: List[str], filters: dict) -> List[dict]:
    """
    Fetch machines from MongoDB for given dates with optional filters.
    Returns empty list if MongoDB is not available or has no data.
    
    Note: AWS enmaz_db uses 'dataUpdatedTime' field instead of 'date' field.
    """
    try:
        db = get_database()
        if db is None:
            return []
        
        machines_collection = db.machines
        
        # Build MongoDB query
        # AWS database uses dataUpdatedTime field, not date field
        # Try both date formats to support different database schemas
        query = {}
        
        # First, check if any document has a 'date' field (local schema)
        # If not, we'll query without date filter and filter in Python
        # since dataUpdatedTime is a string like "Wed, 05 Jun 2024 18:30:00 GMT"
        
        # Add filters
        if filters.get("customerId"):
            query["customerId"] = {"$regex": f"^{filters['customerId']}$", "$options": "i"}
        if filters.get("areaId"):
            query["areaId"] = {"$regex": f"^{filters['areaId']}$", "$options": "i"}
        if filters.get("subAreaId"):
            query["subAreaId"] = {"$regex": f"^{filters['subAreaId']}$", "$options": "i"}
        if filters.get("machineType"):
            query["machineType"] = {"$regex": f"^{filters['machineType']}$", "$options": "i"}
        if filters.get("statusId"):
            query["statusId"] = {"$regex": f"^{filters['statusId']}$", "$options": "i"}
        if filters.get("technologyId"):
            query["technologyId"] = {"$regex": f"^{filters['technologyId']}$", "$options": "i"}
        if filters.get("name"):
            query["name"] = {"$regex": f"^{filters['name']}$", "$options": "i"}
        
        # Handle status/statusName filter
        status_filter = filters.get("statusName") or filters.get("status")
        if status_filter:
            # Normalize unsatisfactory/unacceptable
            status_variations = [status_filter]
            if status_filter.lower() == 'unsatisfactory':
                status_variations.append('Unacceptable')
            elif status_filter.lower() == 'unacceptable':
                status_variations.append('Unsatisfactory')
            
            status_regex = '|'.join([f"^{s}$" for s in status_variations])
            query["$or"] = [
                {"status": {"$regex": status_regex, "$options": "i"}},
                {"statusName": {"$regex": status_regex, "$options": "i"}}
            ]
        
        # Execute query - fetch all and filter by date in Python
        # This is needed because dataUpdatedTime is a complex string format
        cursor = machines_collection.find(query)
        all_machines = await cursor.to_list(length=None)
        
        # Filter by date if date_list is provided
        # Parse dataUpdatedTime and check if it matches any date in date_list
        if date_list:
            filtered_machines = []
            for machine in all_machines:
                data_time = machine.get("dataUpdatedTime", "")
                if data_time:
                    try:
                        # Try to parse "Wed, 05 Jun 2024 18:30:00 GMT" format
                        from email.utils import parsedate_to_datetime
                        parsed_date = parsedate_to_datetime(data_time)
                        machine_date_str = parsed_date.strftime("%Y-%m-%d")
                        if machine_date_str in date_list:
                            # Add date field for frontend compatibility
                            machine["date"] = machine_date_str
                            filtered_machines.append(machine)
                    except Exception:
                        # Try other date formats
                        try:
                            # ISO format
                            if "T" in data_time:
                                machine_date_str = data_time.split("T")[0]
                            else:
                                machine_date_str = data_time[:10]
                            if machine_date_str in date_list:
                                machine["date"] = machine_date_str
                                filtered_machines.append(machine)
                        except Exception:
                            continue
            machines = filtered_machines
        else:
            machines = all_machines
        
        logging.info(f"📦 Fetched {len(machines)} machines from MongoDB for dates: {date_list[:3]}...")
        
        return machines
        
    except Exception as e:
        logging.warning(f"MongoDB fetch failed: {e}")
        return []


async def check_mongodb_has_data(date_list: List[str]) -> bool:
    """Check if MongoDB has any data (date filtering is done in Python now)"""
    try:
        db = get_database()
        if db is None:
            return False
        
        machines_collection = db.machines
        # Just check if there are any machines in the collection
        # Date filtering is done in fetch_machines_from_mongodb
        count = await machines_collection.count_documents({})
        return count > 0
    except Exception:
        return False


async def fetch_bearings_from_mongodb(machine_id: str) -> List[dict]:
    """
    Fetch bearing locations from MongoDB for a given machine.
    Returns empty list if MongoDB is not available or has no data.
    """
    try:
        db = get_database()
        if db is None:
            logging.info(f"[MongoDB] Database not available for bearing lookup")
            return []
        
        # Try bearing_locations collection first
        try:
            bearing_collection = db.bearing_locations
            cursor = bearing_collection.find({"machineId": machine_id})
            bearings = await cursor.to_list(length=None)
            
            if bearings:
                logging.info(f"📦 Fetched {len(bearings)} bearings from MongoDB (bearing_locations collection)")
                return bearings
        except Exception as e:
            logging.debug(f"bearing_locations collection not found or error: {e}")
        
        # Try looking in machines collection for embedded bearings
        try:
            machines_collection = db.machines
            machine = await machines_collection.find_one({
                "$or": [
                    {"_id": machine_id},
                    {"machineId": machine_id}
                ]
            })
            
            if machine and "bearings" in machine:
                bearings = machine.get("bearings", [])
                if bearings:
                    logging.info(f"📦 Fetched {len(bearings)} embedded bearings from MongoDB (machines collection)")
                    return bearings
            
            # Check for bearingLocations field (alternative naming)
            if machine and "bearingLocations" in machine:
                bearings = machine.get("bearingLocations", [])
                if bearings:
                    logging.info(f"📦 Fetched {len(bearings)} bearingLocations from MongoDB")
                    return bearings
        except Exception as e:
            logging.debug(f"Error looking up bearings in machines collection: {e}")
        
        logging.info(f"[MongoDB] No bearings found for machine {machine_id}")
        return []
        
    except Exception as e:
        logging.warning(f"MongoDB bearing fetch failed: {e}")
        return []


async def fetch_machine_from_mongodb(machine_id: str) -> Optional[dict]:
    """
    Fetch a single machine from MongoDB by ID.
    Returns None if not found.
    """
    try:
        db = get_database()
        if db is None:
            return None
        
        machines_collection = db.machines
        
        # Try to find by machineId or _id
        machine = await machines_collection.find_one({
            "$or": [
                {"machineId": machine_id},
                {"_id": machine_id}
            ]
        })
        
        if machine:
            logging.info(f"📦 Found machine {machine_id} in MongoDB")
            return machine
        
        return None
        
    except Exception as e:
        logging.warning(f"MongoDB machine fetch failed: {e}")
        return None


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
    name: Optional[str] = Query(None),
    source: Optional[str] = Query(None, description="Data source: 'db' for MongoDB only, 'api' for external API only, default tries DB first")
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
        data_source = "api"  # Track where data came from

        # ---------------- Build filters dict ----------------
        filters = {
            "customerId": customerId,
            "areaId": areaId,
            "subAreaId": subAreaId,
            "machineType": machineType,
            "statusId": statusId,
            "statusName": statusName,
            "status": status,
            "technologyId": technologyId,
            "name": name,
        }

        # ---------------- Try MongoDB First (unless source=api) ----------------
        if source != "api":
            mongodb_machines = await fetch_machines_from_mongodb(date_list, filters)
            if mongodb_machines:
                all_machines = mongodb_machines
                data_source = "mongodb"
                logging.info(f"✅ Using MongoDB data: {len(all_machines)} machines")

        # ---------------- Fallback to External API (if no MongoDB data or source=api) ----------------
        if not all_machines and source != "db":
            logging.info("📡 Fetching from external API...")
            
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

            # ---------------- Apply Filters (only for API data, MongoDB already filtered) ----------------
            # If status is provided but statusName is not, use status for statusName filtering
            effective_statusName = statusName or status
            
            api_filters = {
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
            has_filters = any(value for value in api_filters.values() if value)
            
            if has_filters:
                filtered_machines = []
                for m in all_machines:
                    # Check all filters
                    match = True
                    for key, value in api_filters.items():
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

        # ---------------- Optional: Filter by date range (for API data) ----------------
        if date_from and date_to and data_source == "api":
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
        # Also handle new API format where customer, areaId, subAreaId are nested objects
        for m in all_machines:
            # Handle customer - now an array of objects with _id and name
            customer_data = m.get("customer", [])
            if isinstance(customer_data, list) and len(customer_data) > 0:
                first_customer = customer_data[0]
                if isinstance(first_customer, dict):
                    m["customerId"] = first_customer.get("_id", "N/A")
                    m["customerName"] = first_customer.get("name", "N/A")
                else:
                    m["customerId"] = str(first_customer) if first_customer else "N/A"
                    m["customerName"] = "N/A"
            elif isinstance(customer_data, dict):
                m["customerId"] = customer_data.get("_id", "N/A")
                m["customerName"] = customer_data.get("name", "N/A")
            else:
                m["customerId"] = m.get("customerId", "N/A")
                m["customerName"] = m.get("customerName", "N/A")
            
            # Handle areaId - now an object with _id and name
            area_data = m.get("areaId", {})
            if isinstance(area_data, dict):
                m["areaIdRaw"] = area_data.get("_id", "N/A")
                m["areaName"] = area_data.get("name", "N/A")
                m["areaId"] = area_data.get("name", area_data.get("_id", "N/A"))
            elif isinstance(area_data, str):
                m["areaId"] = area_data if area_data else "N/A"
                m["areaName"] = area_data if area_data else "N/A"
            else:
                m["areaId"] = "N/A"
                m["areaName"] = "N/A"
            
            # Handle subAreaId - now an object with _id and name
            subarea_data = m.get("subAreaId", {})
            if isinstance(subarea_data, dict):
                m["subAreaIdRaw"] = subarea_data.get("_id", "N/A")
                m["subAreaName"] = subarea_data.get("name", "N/A")
                m["subAreaId"] = subarea_data.get("name", subarea_data.get("_id", "N/A"))
            elif isinstance(subarea_data, str):
                m["subAreaId"] = subarea_data if subarea_data else "N/A"
                m["subAreaName"] = subarea_data if subarea_data else "N/A"
            else:
                m["subAreaId"] = "N/A"
                m["subAreaName"] = "N/A"
            
            # Set default values for remaining required fields
            if "statusName" not in m or m["statusName"] in [None, ""]:
                m["statusName"] = "N/A"
            if "dataUpdatedTime" not in m or m["dataUpdatedTime"] in [None, ""]:
                m["dataUpdatedTime"] = "N/A"
            if "name" not in m or m["name"] in [None, ""]:
                m["name"] = ""
            
            # Handle type/machineType - check machineType first (contains online/offline)
            if "machineType" in m and m["machineType"] not in [None, "", "N/A"]:
                m["type"] = m["machineType"].upper() if isinstance(m["machineType"], str) else "OFFLINE"
            elif "type" not in m or m["type"] in [None, "", "N/A"]:
                m["type"] = "OFFLINE"
            elif isinstance(m["type"], str):
                m["type"] = m["type"].upper()
        
        # Convert MongoDB ObjectIds and other non-serializable objects to JSON-serializable format
        machines_serialized = make_json_serializable(all_machines)
        
        # Response
        return {
            "totalCount": len(machines_serialized),
            "machines": machines_serialized,
            "source": data_source  # Indicates where data came from: 'mongodb' or 'api'
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
    Fetch a specific machine and its bearings.
    Uses MongoDB first, falls back to external API if not found.
    """
    data_source = "api"
    
    try:
        machine = None
        bearings = []
        
        # =============== Step 1: Try MongoDB First ===============
        logging.info(f"[Machine Detail] Looking up machine {machine_id} in MongoDB...")
        
        # Try to get machine from MongoDB
        machine = await fetch_machine_from_mongodb(machine_id)
        
        if machine:
            data_source = "mongodb"
            logging.info(f"✅ [MongoDB] Found machine {machine_id}")
            
            # Try to get bearings from MongoDB
            bearings = await fetch_bearings_from_mongodb(machine_id)
            if bearings:
                logging.info(f"✅ [MongoDB] Found {len(bearings)} bearings for machine {machine_id}")
        
        # =============== Step 2: Fallback to External API if needed ===============
        if not machine or not bearings:
            logging.info(f"📡 [External API] Fetching data for machine {machine_id}...")
            
            async with httpx.AsyncClient(timeout=120) as client:
                # Fetch from BearingLocation API (returns machine + bearings)
                res = await client.post(BEARING_URL, headers=HEADERS, json={"machineId": machine_id})
                
                if res.status_code == 200:
                    try:
                        api_data = res.json()
                        
                        if api_data and isinstance(api_data, list):
                            # BearingLocation API returns a list of bearings
                            # The bearings contain machine info
                            if not bearings:
                                bearings = api_data
                                logging.info(f"📡 [External API] Fetched {len(bearings)} bearings")
                            
                            # Try to extract machine info from first bearing if not already found
                            if not machine and len(api_data) > 0:
                                first_item = api_data[0]
                                # Try to construct machine from bearing data
                                machine = {
                                    "_id": first_item.get("machineId", machine_id),
                                    "machineId": first_item.get("machineId", machine_id),
                                    "name": first_item.get("machineName", ""),
                                    "customerId": first_item.get("customerId", "N/A"),
                                    "areaId": first_item.get("areaId", "N/A"),
                                    "type": first_item.get("type", "OFFLINE"),
                                    "dataUpdatedTime": first_item.get("dataUpdatedTime", "N/A"),
                                }
                                data_source = "api"
                                logging.info(f"📡 [External API] Constructed machine info from bearings")
                    except Exception as json_err:
                        logging.error(f"Error parsing API response: {json_err}")
                else:
                    logging.warning(f"External API returned {res.status_code}")
        
        # =============== Step 3: Validate we have data ===============
        if not machine:
            logging.error(f"Machine with ID {machine_id} not found in MongoDB or API")
            raise HTTPException(status_code=404, detail=f"Machine with ID {machine_id} not found")
        
        # Ensure bearings is a list
        if not isinstance(bearings, list):
            bearings = []
        
        # Add default FFT data if not provided
        for b in bearings:
            b.setdefault("fftData", [{"frequency": f, "amplitude": 1.0} for f in range(1, 11)])

        # =============== Step 4: Ensure all expected fields are present ===============
        machine["customerId"] = machine.get("customerId") or "N/A"
        machine["areaId"] = machine.get("areaId") or "N/A"
        machine["type"] = machine.get("type") or "N/A"
        machine["dataUpdatedTime"] = machine.get("dataUpdatedTime") or "N/A"
        machine["bearings"] = bearings
        machine["source"] = data_source

        # Convert MongoDB ObjectIds and other non-serializable objects to JSON-serializable format
        machine_serialized = make_json_serializable(machine)

        return {"machine": machine_serialized, "source": data_source}

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
                logging.info(f"External API response keys: {data.keys() if isinstance(data, dict) else 'not a dict'}")
                logging.info(f"External API response sample: {str(data)[:500]}")
                all_data.append(data)

        if not all_data:
            logging.warning(f"No data returned from external API for bearing {bearing_id}")
            raise HTTPException(status_code=404, detail="No data found for this bearing")

        merged = all_data[0]
        # Ensure rawData is available as rowdata for frontend compatibility
        if "rawData" in merged:
            merged["rowdata"] = merged["rawData"]
        # Also check for other common data field names
        if "data" in merged and isinstance(merged["data"], list):
            merged["rowdata"] = merged["data"]
        if "fftData" not in merged and "rowdata" in merged:
            merged["fftData"] = merged["rowdata"]
        
        logging.info(f"Final merged data keys: {merged.keys()}")

        # Convert MongoDB ObjectIds and other non-serializable objects to JSON-serializable format
        merged_serialized = make_json_serializable(merged)

        return {"totalDays": len(all_data), "data": merged_serialized}

    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"Failed to fetch bearing data {bearing_id}")
        raise HTTPException(status_code=500, detail=str(e))


# ------------------- 4️⃣ FFT Analysis (All Axes) -------------------
@router.get("/machines/fft-analysis/{machine_id}/{bearing_id}")
@router.post("/machines/fft-analysis/{machine_id}/{bearing_id}")
async def get_fft_analysis(
    machine_id: str,
    bearing_id: str,
    data_type: Optional[str] = Query("OFFLINE", description="Data type: ONLINE or OFFLINE"),
    machine_class: Optional[str] = Query("II", description="ISO machine class: I, II, III, IV")
):
    """
    Perform comprehensive FFT analysis on bearing vibration data for all axes (H, V, A).
    
    Returns:
    - FFT spectrum for each axis
    - Peak detection at 1× running frequency (±5% tolerance)
    - Harmonic detection (1×-10× running frequency)
    - ISO 10816-3 severity assessment
    - Fault diagnosis with recommendations
    """
    # Add verbose logging for debugging
    print(f"[FFT] Starting analysis for machine={machine_id}, bearing={bearing_id}")
    logging.info(f"[FFT] Starting analysis for machine={machine_id}, bearing={bearing_id}, type={data_type}")
    
    if perform_complete_analysis is None:
        logging.error("[FFT] perform_complete_analysis is None - numpy not available?")
        print("[FFT] ERROR: perform_complete_analysis is None")
        raise HTTPException(
            status_code=500, 
            detail="FFT analysis service not available. Please install numpy."
        )
    
    try:
        axes = ['H-Axis', 'V-Axis', 'A-Axis']
        axis_results = {}
        rpm = None
        sample_rate = None
        
        async with httpx.AsyncClient(timeout=60) as client:
            for axis in axes:
                payload = {
                    "machineId": machine_id,
                    "bearingLocationId": bearing_id,
                    "Axis_Id": axis,
                    "type": data_type,
                    "Analytics_Types": "MF"
                }
                
                # Log the API request (flush=True for immediate output in cmd)
                print(f"\n{'='*60}", flush=True)
                print(f"[FFT API] Fetching {axis} data", flush=True)
                print(f"[FFT API] URL: {DATA_URL}", flush=True)
                print(f"[FFT API] Request: machineId={machine_id}, bearingId={bearing_id}, axis={axis}, type={data_type}", flush=True)
                
                try:
                    response = await client.post(DATA_URL, headers=HEADERS, json=payload)
                    
                    # Log the response
                    print(f"[FFT API] Response Status: {response.status_code}", flush=True)
                    
                    if response.status_code != 200:
                        print(f"[FFT API] ❌ ERROR: API returned {response.status_code} for {axis}", flush=True)
                        logging.warning(f"API returned {response.status_code} for {axis}")
                        axis_results[axis] = {
                            'error': f'API error: {response.status_code}',
                            'available': False
                        }
                        continue
                    
                    data = response.json()
                    
                    # Log received data
                    print(f"[FFT API] ✓ Data received: RPM={data.get('rpm')}, SR={data.get('SR')}, rawData points={len(data.get('rawData', []))}", flush=True)
                    
                    # Extract required fields
                    raw_data = data.get('rawData', [])
                    axis_rpm = data.get('rpm')
                    axis_sr = data.get('SR')
                    
                    # Parse sample rate
                    if axis_sr:
                        try:
                            sample_rate = float(axis_sr)
                        except (ValueError, TypeError):
                            sample_rate = 10000.0  # Default
                    else:
                        sample_rate = 10000.0
                    
                    # Parse RPM
                    if axis_rpm:
                        try:
                            rpm = float(axis_rpm)
                        except (ValueError, TypeError):
                            pass
                    
                    # Check for valid data
                    if not raw_data or len(raw_data) < 100:
                        logging.warning(f"Insufficient data for {axis}: {len(raw_data) if raw_data else 0} points")
                        axis_results[axis] = {
                            'error': 'Insufficient vibration data',
                            'available': False
                        }
                        continue
                    
                    if not rpm or rpm <= 0:
                        logging.warning(f"Invalid RPM for {axis}: {rpm}")
                        axis_results[axis] = {
                            'error': 'RPM not available - cannot analyze',
                            'available': False
                        }
                        continue
                    
                    # Parse raw data (handle various formats)
                    if isinstance(raw_data, str):
                        # String format: comma-separated values
                        raw_data = [float(x.strip()) for x in raw_data.split(',') if x.strip()]
                    elif isinstance(raw_data, list):
                        # List format: convert all elements to float
                        parsed_data = []
                        for x in raw_data:
                            try:
                                if isinstance(x, str):
                                    parsed_data.append(float(x.strip()))
                                elif isinstance(x, (int, float)):
                                    parsed_data.append(float(x))
                                else:
                                    parsed_data.append(float(x))
                            except (ValueError, TypeError):
                                continue
                        raw_data = parsed_data
                    
                    if len(raw_data) < 100:
                        logging.warning(f"After parsing, insufficient data for {axis}: {len(raw_data)} points")
                        axis_results[axis] = {
                            'error': 'Insufficient valid data points after parsing',
                            'available': False
                        }
                        continue
                    
                    logging.info(f"Performing FFT analysis for {axis}: {len(raw_data)} points, RPM={rpm}, SR={sample_rate}")
                    
                    # Perform FFT analysis
                    axis_short = axis.replace('-Axis', '')
                    analysis = perform_complete_analysis(
                        raw_data=raw_data,
                        sample_rate=sample_rate,
                        rpm=rpm,
                        axis=axis_short,
                        machine_class=machine_class
                    )
                    
                    axis_results[axis] = {
                        'available': True,
                        **analysis
                    }
                    
                except Exception as axis_err:
                    logging.exception(f"Error processing {axis}: {axis_err}")
                    axis_results[axis] = {
                        'error': str(axis_err),
                        'available': False
                    }
        
        # =============== Fetch bearing status (MongoDB first, API fallback) ===============
            external_status = None
            status_source = "none"
            print(f"\n{'='*60}")
            print(f"[FFT API] Looking up bearing status...")
            
            # Step 1: Try MongoDB first
            try:
                db_bearings = await fetch_bearings_from_mongodb(machine_id)
                if db_bearings:
                    for b in db_bearings:
                        b_id = str(b.get('_id', ''))
                        if b_id == bearing_id or b.get('bearingLocationId') == bearing_id:
                            external_status = b.get('statusName') or b.get('status', 'Unknown')
                            status_source = "mongodb"
                            print(f"[FFT API] ✓ Found status in MongoDB for bearing {bearing_id[-8:]}: {external_status}", flush=True)
                            logging.info(f"Found bearing status in MongoDB: {external_status}")
                            break
            except Exception as e:
                logging.debug(f"MongoDB bearing lookup failed: {e}")
            
            # Step 2: Fallback to external API if not found in MongoDB
            if not external_status:
                print(f"[FFT API] MongoDB lookup empty, trying external API...")
                print(f"[FFT API] URL: {BEARING_URL}")
                print(f"[FFT API] Request: machineId={machine_id}")
                try:
                    bearing_response = await client.post(
                        BEARING_URL, 
                        headers=HEADERS, 
                        json={"machineId": machine_id}
                    )
                    print(f"[FFT API] BearingLocation Response Status: {bearing_response.status_code}", flush=True)
                    if bearing_response.status_code == 200:
                        bearings_data = bearing_response.json()
                        print(f"[FFT API] Found {len(bearings_data)} bearings from API", flush=True)
                        # Find the specific bearing
                        for b in bearings_data:
                            if b.get('_id') == bearing_id:
                                external_status = b.get('statusName', 'Unknown')
                                status_source = "api"
                                print(f"[FFT API] ✓ External status for bearing {bearing_id[-8:]}: {external_status}", flush=True)
                                logging.info(f"Found external status for bearing {bearing_id}: {external_status}")
                                break
                        if not external_status:
                            print(f"[FFT API] ⚠ Bearing {bearing_id[-8:]} not found in BearingLocation response", flush=True)
                except Exception as e:
                    print(f"[FFT API] ❌ Failed to fetch external status: {e}", flush=True)
                    logging.warning(f"Failed to fetch external bearing status: {e}")
        
        
        print(f"\n{'='*60}", flush=True)
        print(f"[FFT API] Analysis complete for machine={machine_id[-8:]}, bearing={bearing_id[-8:]}", flush=True)
        print(f"[FFT API] Axes available: {[axis for axis, r in axis_results.items() if r.get('available')]}", flush=True)
        print(f"[FFT API] External Status: {external_status}", flush=True)
        print(f"{'='*60}\n", flush=True)
        
        # Determine overall severity (worst case across axes)
        overall_severity = None
        severity_order = ['A', 'B', 'C', 'D']
        
        for axis, result in axis_results.items():
            if result.get('available') and result.get('severity'):
                zone = result['severity'].get('zone', 'A')
                if overall_severity is None:
                    overall_severity = result['severity']
                elif severity_order.index(zone) > severity_order.index(overall_severity.get('zone', 'A')):
                    overall_severity = result['severity']
        
        # Determine overall diagnosis (combine evidence from all axes)
        overall_diagnosis = None
        all_evidence = []
        max_harmonic_count = 0
        
        for axis, result in axis_results.items():
            if result.get('available') and result.get('diagnosis'):
                diag = result['diagnosis']
                all_evidence.extend(diag.get('evidence', []))
                max_harmonic_count = max(max_harmonic_count, diag.get('harmonicCount', 0))
                
                # Use the diagnosis with highest confidence
                if overall_diagnosis is None:
                    overall_diagnosis = diag
                elif diag.get('confidence') == 'High' and overall_diagnosis.get('confidence') != 'High':
                    overall_diagnosis = diag
        
        if overall_diagnosis:
            overall_diagnosis['evidence'] = list(set(all_evidence))[:5]  # Unique evidence, max 5
            overall_diagnosis['harmonicCount'] = max_harmonic_count
        
        return {
            'success': True,
            'machineId': machine_id,
            'bearingId': bearing_id,
            'machineClass': machine_class,
            'rpm': rpm,
            'runningFrequency': round(rpm / 60.0, 2) if rpm else None,
            'sampleRate': sample_rate,
            'axisData': axis_results,
            'overallSeverity': overall_severity,
            'overallDiagnosis': overall_diagnosis,
            'externalStatus': external_status  # Status from AAMS BearingLocation API
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"FFT analysis failed for {machine_id}/{bearing_id}")
        raise HTTPException(status_code=500, detail=f"FFT analysis failed: {str(e)}")

