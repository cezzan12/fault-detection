# File: app/services/sync_service.py
"""
Data Sync Service
Fetches data from external AAMS API and stores it in MongoDB
"""
import httpx
import asyncio
from datetime import datetime, timedelta
from typing import List, Optional
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# External API URLs
MACHINE_URL = "https://srcapiv2.aams.io/AAMS/AI/Machine"
HEADERS = {'Content-Type': 'application/json'}

# HTTP Client settings
_sync_client = None


def get_sync_client():
    """Get or create HTTP client for sync operations"""
    global _sync_client
    if _sync_client is None:
        _sync_client = httpx.AsyncClient(
            timeout=httpx.Timeout(120.0, connect=30.0),
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=50),
        )
    return _sync_client


async def fetch_machines_from_api(date_str: str) -> List[dict]:
    """
    Fetch machines data from external API for a specific date
    """
    try:
        client = get_sync_client()
        payload = {"date": date_str}
        response = await client.post(MACHINE_URL, headers=HEADERS, json=payload)
        
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                if "machines" in data:
                    return data.get("machines", [])
                if "data" in data and isinstance(data.get("data"), list):
                    return data.get("data", [])
            return []
        else:
            logger.warning(f"API returned status {response.status_code} for date {date_str}")
            return []
    except Exception as e:
        logger.error(f"Error fetching machines for date {date_str}: {e}")
        return []


async def sync_machines_for_date(db, date_str: str) -> dict:
    """
    Sync machines data for a specific date
    Returns sync statistics
    """
    machines_collection = db.machines
    
    # Fetch from external API
    machines = await fetch_machines_from_api(date_str)
    
    if not machines:
        return {
            "date": date_str,
            "fetched": 0,
            "inserted": 0,
            "updated": 0,
            "status": "no_data"
        }
    
    # Add date field and sync metadata to each machine
    inserted = 0
    updated = 0
    
    for machine in machines:
        # Add/update metadata
        machine["date"] = date_str
        machine["synced_at"] = datetime.utcnow()
        
        # Ensure required fields have default values
        required_fields = [
            ("customerId", "N/A"),
            ("statusName", "N/A"),
            ("areaId", "N/A"),
            ("dataUpdatedTime", "N/A"),
            ("name", ""),
        ]
        for field, default in required_fields:
            if field not in machine or machine[field] in [None, ""]:
                machine[field] = default
        
        # Handle type/machineType - check for value in machineType first, then type
        # machineType typically contains "online" or "offline"
        if "machineType" in machine and machine["machineType"] not in [None, "", "N/A"]:
            machine["type"] = machine["machineType"].upper()  # Normalize to uppercase
        elif "type" not in machine or machine["type"] in [None, ""]:
            machine["type"] = "OFFLINE"  # Default to OFFLINE
        else:
            machine["type"] = machine["type"].upper() if isinstance(machine["type"], str) else "OFFLINE"
        
        # Use upsert to avoid duplicates
        # Create a unique identifier based on machine properties
        original_id = machine.get("_id")
        machine_id = machine.get("machineId") or original_id
        
        # Remove _id from document to avoid duplicate key errors
        if "_id" in machine:
            del machine["_id"]
        
        if machine_id:
            result = await machines_collection.update_one(
                {"machineId": machine_id, "date": date_str},
                {"$set": machine},
                upsert=True
            )
            if result.upserted_id:
                inserted += 1
            elif result.modified_count > 0:
                updated += 1
        else:
            # If no ID, use a combination of fields as unique key
            filter_key = {
                "date": date_str,
                "customerId": machine.get("customerId"),
                "name": machine.get("name"),
                "areaId": machine.get("areaId")
            }
            result = await machines_collection.update_one(
                filter_key,
                {"$set": machine},
                upsert=True
            )
            if result.upserted_id:
                inserted += 1
            elif result.modified_count > 0:
                updated += 1
    
    return {
        "date": date_str,
        "fetched": len(machines),
        "inserted": inserted,
        "updated": updated,
        "status": "success"
    }


async def sync_date_range(db, start_date: str, end_date: str, batch_size: int = 5) -> dict:
    """
    Sync machines data for a date range
    Uses batching to avoid overwhelming the external API
    """
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    
    dates = []
    current = start
    while current <= end:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    
    total_stats = {
        "total_dates": len(dates),
        "total_fetched": 0,
        "total_inserted": 0,
        "total_updated": 0,
        "failed_dates": [],
        "date_stats": []
    }
    
    # Process in batches
    for i in range(0, len(dates), batch_size):
        batch = dates[i:i + batch_size]
        logger.info(f"Syncing batch {i // batch_size + 1}: {batch}")
        
        # Sync batch in parallel
        tasks = [sync_machines_for_date(db, date) for date in batch]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, Exception):
                logger.error(f"Batch sync error: {result}")
                total_stats["failed_dates"].append(str(result))
            elif isinstance(result, dict):
                total_stats["total_fetched"] += result.get("fetched", 0)
                total_stats["total_inserted"] += result.get("inserted", 0)
                total_stats["total_updated"] += result.get("updated", 0)
                total_stats["date_stats"].append(result)
                
                if result.get("status") != "success":
                    total_stats["failed_dates"].append(result.get("date"))
        
        # Small delay between batches to be nice to the external API
        if i + batch_size < len(dates):
            await asyncio.sleep(1)
    
    # Update sync metadata
    await update_sync_metadata(db, start_date, end_date, total_stats)
    
    return total_stats


async def sync_today(db) -> dict:
    """Sync today's data"""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    return await sync_machines_for_date(db, today)


async def sync_last_n_days(db, days: int = 7) -> dict:
    """Sync last N days of data"""
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days - 1)
    
    return await sync_date_range(
        db,
        start_date.strftime("%Y-%m-%d"),
        end_date.strftime("%Y-%m-%d")
    )


async def update_sync_metadata(db, start_date: str, end_date: str, stats: dict):
    """Update sync metadata in database"""
    sync_collection = db.sync_metadata
    
    await sync_collection.update_one(
        {"sync_type": "machines"},
        {
            "$set": {
                "last_sync": datetime.utcnow(),
                "last_sync_range": {
                    "start": start_date,
                    "end": end_date
                },
                "last_sync_stats": {
                    "fetched": stats["total_fetched"],
                    "inserted": stats["total_inserted"],
                    "updated": stats["total_updated"]
                }
            }
        },
        upsert=True
    )


async def get_sync_status(db) -> Optional[dict]:
    """Get current sync status"""
    sync_collection = db.sync_metadata
    status = await sync_collection.find_one({"sync_type": "machines"})
    
    if status:
        # Convert ObjectId to string for JSON serialization
        status["_id"] = str(status["_id"])
        if "last_sync" in status:
            status["last_sync"] = status["last_sync"].isoformat()
    
    return status


async def get_available_dates(db) -> List[str]:
    """Get list of dates available in the database"""
    machines_collection = db.machines
    dates = await machines_collection.distinct("date")
    return sorted(dates, reverse=True)


async def get_machine_count(db) -> int:
    """Get total count of machines in database"""
    machines_collection = db.machines
    return await machines_collection.count_documents({})
