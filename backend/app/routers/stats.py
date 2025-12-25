# File: app/routers/stats.py
from fastapi import APIRouter, Query

from datetime import datetime, timedelta
from typing import List
import itertools

# Support both absolute and relative imports
try:
    from app.database import get_database
except ImportError:
    try:
        from database import get_database
    except ImportError:
        def get_database():
            return None

router = APIRouter()


def get_db():
    """Get database, returns None if not available"""
    try:
        return get_database()
    except Exception:
        return None


# PIE CHART
@router.get("/pie")
async def pie_chart(date: str = Query(...), customerId: str = Query(None)):
    """Count machines per customer for a given day"""
    db = get_db()
    if db is None:
        return {"data": [], "error": "Database not connected"}
    
    match = {"date": date}
    if customerId:
        match["customerId"] = customerId

    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$customerId", "count": {"$sum": 1}}}
    ]
    result = await db.machines.aggregate(pipeline).to_list(None)
    return {"data": result}


# STACKED BAR CHART (daily, weekly, monthly)
@router.get("/stacked")
async def stacked_chart(
    view: str = Query("monthly"),  # daily, weekly, monthly
    date_from: str = Query(...),
    date_to: str = Query(...),
    customerId: str = Query(None),
):
    """Return machine status counts for stacked bar chart.
    
    This endpoint fetches all machines and groups them by date and status.
    It uses the 'dataUpdatedTime' field from MongoDB machines collection,
    which contains datetime strings like 'Wed, 05 Jun 2024 18:30:00 GMT'.
    """
    db = get_db()
    if db is None:
        return {"dates": [], "statuses": {}, "error": "Database not connected"}
    
    from email.utils import parsedate_to_datetime
    
    start = datetime.strptime(date_from, "%Y-%m-%d")
    end = datetime.strptime(date_to, "%Y-%m-%d")

    # Build match query for optional customerId filter
    match_query = {}
    if customerId:
        match_query["customerId"] = customerId

    # Fetch all machines (we'll filter by date in Python due to datetime format)
    try:
        cursor = db.machines.find(match_query if match_query else {})
        all_machines = await cursor.to_list(length=None)
    except Exception as e:
        return {"dates": [], "statuses": {}, "error": str(e)}

    # Parse dataUpdatedTime and group by date and status
    date_status_map = {}
    
    for machine in all_machines:
        data_time = machine.get("dataUpdatedTime", "")
        status = machine.get("status") or machine.get("statusName") or "Unknown"
        
        if not data_time:
            continue
            
        try:
            # Try to parse "Wed, 05 Jun 2024 18:30:00 GMT" format
            parsed_date = parsedate_to_datetime(data_time)
            machine_date = parsed_date.date()
        except Exception:
            try:
                # Try ISO format or other formats
                if "T" in str(data_time):
                    machine_date = datetime.fromisoformat(str(data_time).replace('Z', '+00:00')).date()
                else:
                    machine_date = datetime.strptime(str(data_time)[:10], "%Y-%m-%d").date()
            except Exception:
                continue
        
        # Check if date is within range
        if machine_date < start.date() or machine_date > end.date():
            continue
            
        date_str = machine_date.strftime("%Y-%m-%d")
        
        if date_str not in date_status_map:
            date_status_map[date_str] = {"Normal": 0, "Satisfactory": 0, "Alert": 0, "Unacceptable": 0}
        
        # Normalize status
        status_lower = status.lower() if status else ""
        if status_lower == "normal":
            date_status_map[date_str]["Normal"] += 1
        elif status_lower == "satisfactory":
            date_status_map[date_str]["Satisfactory"] += 1
        elif status_lower == "alert":
            date_status_map[date_str]["Alert"] += 1
        elif status_lower in ["unacceptable", "unsatisfactory"]:
            date_status_map[date_str]["Unacceptable"] += 1

    statuses = ["Normal", "Unacceptable", "Alert", "Satisfactory"]

    def daily_dates():
        current = start
        while current <= end:
            yield current.strftime("%Y-%m-%d")
            current += timedelta(days=1)

    def weekly_ranges():
        current = start
        while current <= end:
            week_start = current
            week_end = min(current + timedelta(days=6), end)
            yield (week_start, week_end, f"{week_start.strftime('%Y-%m-%d')} to {week_end.strftime('%Y-%m-%d')}")
            current += timedelta(days=7)

    def monthly_ranges():
        current = start
        while current <= end:
            month_start = current.replace(day=1)
            next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
            month_end = min(next_month - timedelta(days=1), end)
            yield (month_start, month_end, month_start.strftime("%Y-%m"))
            current = next_month

    result_dict = {s: [] for s in statuses}
    labels = []

    if view == "daily":
        for date_str in daily_dates():
            labels.append(date_str)
            for s in statuses:
                result_dict[s].append(date_status_map.get(date_str, {}).get(s, 0))

    elif view == "weekly":
        for week_start, week_end, label in weekly_ranges():
            labels.append(label)
            for s in statuses:
                week_count = sum(
                    date_status_map.get((week_start + timedelta(days=i)).strftime("%Y-%m-%d"), {}).get(s, 0)
                    for i in range((week_end - week_start).days + 1)
                )
                result_dict[s].append(week_count)

    elif view == "monthly":
        for month_start, month_end, label in monthly_ranges():
            labels.append(label)
            for s in statuses:
                month_count = sum(
                    date_status_map.get((month_start + timedelta(days=i)).strftime("%Y-%m-%d"), {}).get(s, 0)
                    for i in range((month_end - month_start).days + 1)
                )
                result_dict[s].append(month_count)
    else:
        return {"error": "Invalid view type. Use 'daily', 'weekly', or 'monthly'."}

    return {"dates": labels, "statuses": result_dict}

