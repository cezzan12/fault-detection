# File: app/routers/stats.py
from fastapi import APIRouter, Query

from datetime import datetime, timedelta
from typing import List
import itertools

router = APIRouter()

# PIE CHART
@router.get("/pie")
async def pie_chart(date: str = Query(...), customerId: str = Query(None)):
    """Count machines per customer for a given day"""
    match = {"date": date}
    if customerId:
        match["customerId"] = customerId

    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$customer", "count": {"$sum": 1}}}
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
    """Return machine status counts for stacked bar chart"""
    start = datetime.strptime(date_from, "%Y-%m-%d")
    end = datetime.strptime(date_to, "%Y-%m-%d")

    match = {"date": {"$gte": date_from, "$lte": date_to}}
    if customerId:
        match["customerId"] = customerId

    pipeline = [
        {"$match": match},
        {"$group": {"_id": {"date": "$date", "status": "$status"}, "count": {"$sum": 1}}}
    ]

    data = await db.machines.aggregate(pipeline).to_list(None)

    # Map data for faster lookup
    data_map = {(item["_id"]["date"], item["_id"]["status"]): item["count"] for item in data}

    statuses = ["Normal", "Unsatisfactory", "Alert", "Satisfactory"]

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
                result_dict[s].append(data_map.get((date_str, s), 0))

    elif view == "weekly":
        for week_start, week_end, label in weekly_ranges():
            labels.append(label)
            for s in statuses:
                week_count = sum(
                    data_map.get(( (week_start + timedelta(days=i)).strftime("%Y-%m-%d"), s ), 0)
                    for i in range((week_end - week_start).days + 1)
                )
                result_dict[s].append(week_count)

    elif view == "monthly":
        for month_start, month_end, label in monthly_ranges():
            labels.append(label)
            for s in statuses:
                month_count = sum(
                    data_map.get(( (month_start + timedelta(days=i)).strftime("%Y-%m-%d"), s ), 0)
                    for i in range((month_end - month_start).days + 1)
                )
                result_dict[s].append(month_count)
    else:
        return {"error": "Invalid view type. Use 'daily', 'weekly', or 'monthly'."}

    return {"dates": labels, "statuses": result_dict}
