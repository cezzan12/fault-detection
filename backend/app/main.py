# File: app/main.py
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import time

# Support both absolute and relative imports
try:
    from app.routers import machines, stats
except ImportError:
    from routers import machines, stats

app = FastAPI(title="Machine Monitoring API")

# ------------------- Request Logging Middleware -------------------
class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Log incoming request
        print(f"{request.method} {request.url.path}")
        
        # Process request
        start_time = time.time()
        response = await call_next(request)
        process_time = time.time() - start_time
        
        # Log completed request with status code
        print(f"{request.method} {request.url.path} - {response.status_code} ({process_time:.3f}s)")
        
        return response

app.add_middleware(RequestLoggingMiddleware)

# ------------------- CORS Settings -------------------
origins = [
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://127.0.0.1:5176",
    "https://machine-health-analytics.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------- Routers -------------------
# Prefix is empty because machines.py already handles `/machines` in the route
app.include_router(machines.router, prefix="", tags=["Machines"])
app.include_router(stats.router, prefix="/stats", tags=["Stats"])

# ------------------- Home Endpoint -------------------
@app.get("/")
def home():
    return {"message": "Welcome to Machine Monitoring API"}

# ------------------- Metadata Endpoint -------------------
@app.get("/metadata")
def metadata():
    return {
        "machines_endpoint": "/machines",
        "stats_endpoint": "/stats",
        "features": [
            "Filtering by status, customerId, areaId, machineType",
            "Date range filtering",
            "Pagination and sorting",
            "Pie and stacked bar chart data",
            "Daily, weekly, monthly aggregation"
        ]
    }
