# File: app/main.py
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
import time
import asyncio

# Support both absolute and relative imports
try:
    from app.routers import machines, stats, sync, report
    from app.database import connect_to_database, close_database_connection, get_database
    from app.services.sync_service import sync_last_n_days
except ImportError:
    from routers import machines, stats, sync, report
    from database import connect_to_database, close_database_connection, get_database
    from services.sync_service import sync_last_n_days


# ------------------- Auto-Sync on Startup -------------------
async def auto_sync_on_startup():
    """
    Automatically sync recent data when server starts.
    Syncs last 2 days to ensure today's data is always available.
    """
    try:
        db = get_database()
        if db is None:
            print("⚠️ Cannot auto-sync: Database not connected")
            return
        
        print("🔄 Auto-syncing last 2 days of data...")
        result = await sync_last_n_days(db, 2)
        print(f"✅ Auto-sync complete: {result['total_fetched']} machines fetched, {result['total_inserted']} inserted, {result['total_updated']} updated")
    except Exception as e:
        print(f"⚠️ Auto-sync failed (non-blocking): {e}")


# ------------------- Lifespan Handler (Database Connection) -------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Handle startup and shutdown events.
    - Connect to MongoDB on startup
    - Auto-sync recent data
    - Close connection on shutdown
    """
    # Startup
    print("🚀 Starting up...")
    try:
        await connect_to_database()
        
        # Run maintenance tasks to ensure data consistency
        from app.services.maintenance import fix_missing_dates
        await fix_missing_dates()
        
        # Auto-sync DISABLED - read-only mode for AWS database
        # await auto_sync_on_startup()
    except Exception as e:
        print(f"⚠️ MongoDB connection failed: {e}")
        print("⚠️ App will run but database features won't work")
    
    yield  # App runs here
    
    # Shutdown
    print("🛑 Shutting down...")
    await close_database_connection()


app = FastAPI(title="Machine Monitoring API", lifespan=lifespan)

# ------------------- Request Logging Middleware -------------------
class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        import sys
        # Log incoming request
        print(f"➡️ {request.method} {request.url.path}")
        sys.stdout.flush()
        
        # Process request
        start_time = time.time()
        response = await call_next(request)
        process_time = time.time() - start_time
        
        # Log completed request with status code
        print(f"✅ {request.method} {request.url.path} - {response.status_code} ({process_time:.3f}s)")
        sys.stdout.flush()
        
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
app.include_router(sync.router, prefix="/sync", tags=["Sync"])
app.include_router(report.router, prefix="", tags=["Reports"])

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
