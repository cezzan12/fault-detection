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
    
    try:
        start = datetime.strptime(date_from, "%Y-%m-%d")
        end = datetime.strptime(date_to, "%Y-%m-%d")
    except ValueError as e:
        return {"dates": [], "statuses": {}, "error": f"Invalid date format: {e}"}

    # 1. Generate target dates list
    target_dates = []
    curr = start
    while curr <= end:
        target_dates.append(curr.strftime("%Y-%m-%d"))
        curr += timedelta(days=1)
        
    if not target_dates:
         return {"dates": [], "statuses": {}}

    # 2. Query machine_dates
    machine_dates_col = db["machine_dates"]
    
    # robust query for mixed schema
    date_conditions = [{"date": {"$in": target_dates}}]
    
    # Regex for dataUpdatedTime (DD Mon YYYY)
    date_regex_parts = []
    for d_str in target_dates:
        try:
             d_obj = datetime.strptime(d_str, "%Y-%m-%d")
             date_regex_parts.append(d_obj.strftime("%d %b %Y"))
        except:
             pass
             
    if date_regex_parts:
        # Optimization: chunk regex if too large? 
        # For a month (30 days), one joined regex is ~350 chars, OK for Mongo.
        joined_regex = "|".join(date_regex_parts)
        date_conditions.append({
            "dataUpdatedTime": {"$regex": joined_regex}
        })
        
    query = {"$or": date_conditions}
    
    try:
        # Fetch machineId, date, dataUpdatedTime
        cursor = machine_dates_col.find(query, {"machineId": 1, "date": 1, "dataUpdatedTime": 1})
        machine_date_records = await cursor.to_list(length=None)
    except Exception as e:
        return {"dates": [], "statuses": {}, "error": str(e)}
        
    # 3. Resolve Machine IDs and Dates
    unique_machine_ids = set()
    events = [] # (date, machineId)
    
    from email.utils import parsedate_to_datetime
    
    for rec in machine_date_records:
        mid = rec.get("machineId")
        if not mid: continue
        
        # Normalize date
        r_date = rec.get("date")
        if not r_date:
            raw = rec.get("dataUpdatedTime")
            if raw:
                try:
                    pd = parsedate_to_datetime(raw)
                    r_date = pd.strftime("%Y-%m-%d")
                except:
                    if "T" in str(raw):
                         r_date = str(raw).split("T")[0]
                    else:
                         r_date = str(raw)[:10]
        
        if r_date and r_date in target_dates:
            events.append((r_date, mid))
            unique_machine_ids.add(mid)
            
    # 4. Fetch Machine Statuses (with filtering)
    machines_col = db.machines
    
    # Map IDs to ObjectId if needed
    query_ids = list(unique_machine_ids)
    try:
        from bson.objectid import ObjectId
        for uid in unique_machine_ids:
             if isinstance(uid, str) and len(uid) == 24:
                 try:
                     query_ids.append(ObjectId(uid))
                 except: pass
    except: pass
    
    machine_query = {"_id": {"$in": query_ids}}
    if customerId:
        machine_query["customerId"] = customerId
        
    try:
        # Only fetch _id and status fields
        m_cursor = machines_col.find(machine_query, {"_id": 1, "status": 1, "statusName": 1})
        machines_list = await m_cursor.to_list(length=None)
    except Exception as e:
        return {"dates": [], "statuses": {}, "error": str(e)}

    # Map machineId -> status
    machine_status_map = {}
    for m in machines_list:
        # key by str(_id)
        mid = str(m.get("_id"))
        st = m.get("statusName") or m.get("status") or "Unknown"
        machine_status_map[mid] = st

    # 5. Build Aggregation Map
    # date -> {Status: count}
    date_status_map = {d: {"Normal": 0, "Satisfactory": 0, "Alert": 0, "Unacceptable": 0} for d in target_dates}
    
    for r_date, m_id in events:
        if m_id in machine_status_map:
            st = machine_status_map[m_id]
            st_lower = st.lower()
            
            bucket = None
            if st_lower == "normal": bucket = "Normal"
            elif st_lower == "satisfactory": bucket = "Satisfactory"
            elif st_lower == "alert": bucket = "Alert"
            elif st_lower in ["unacceptable", "unsatisfactory"]: bucket = "Unacceptable"
            
            if bucket:
                date_status_map[r_date][bucket] += 1
                
    # 6. Format Return Data (View Logic)
    statuses = ["Normal", "Unacceptable", "Alert", "Satisfactory"]
    result_dict = {s: [] for s in statuses}
    labels = []
    
    # Internal helpers for view generation
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

    if view == "daily":
        for d in target_dates:
            labels.append(d)
            for s in statuses:
                result_dict[s].append(date_status_map[d].get(s, 0))
                
    elif view == "weekly":
        for ws, we, lbl in weekly_ranges():
            labels.append(lbl)
            # sum counts for days in checking range
            range_days = []
            c = ws
            while c <= we:
                range_days.append(c.strftime("%Y-%m-%d"))
                c += timedelta(days=1)
                
            for s in statuses:
                count = sum(date_status_map.get(rd, {}).get(s, 0) for rd in range_days)
                result_dict[s].append(count)
                
    elif view == "monthly":
        for ms, me, lbl in monthly_ranges():
            labels.append(lbl)
            range_days = []
            c = ms
            while c <= me:
                range_days.append(c.strftime("%Y-%m-%d"))
                c += timedelta(days=1)
                
            for s in statuses:
                count = sum(date_status_map.get(rd, {}).get(s, 0) for rd in range_days)
                result_dict[s].append(count)
                
    else:
        return {"error": "Invalid view type"}
        
    return {"dates": labels, "statuses": result_dict}

