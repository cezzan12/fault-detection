"""
Report Generation Router

Exposes endpoints for generating machine vibration analysis reports.
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import Optional
import logging
from datetime import datetime

# Import report service
try:
    from app.services.report_service import (
        prepare_report_data,
        generate_pdf_report,
        generate_report,
        fetch_bearings_for_machine
    )
except ImportError:
    from services.report_service import (
        prepare_report_data,
        generate_pdf_report,
        generate_report,
        fetch_bearings_for_machine
    )

# Import database for machine lookup
try:
    from app.database import get_database
except ImportError:
    try:
        from database import get_database
    except ImportError:
        def get_database():
            return None

router = APIRouter()


async def fetch_machine_from_db(machine_id: str) -> Optional[dict]:
    """Fetch machine from MongoDB."""
    try:
        db = get_database()
        if db is None:
            return None
        
        machines_collection = db.machines
        machine = await machines_collection.find_one({
            "$or": [
                {"machineId": machine_id},
                {"_id": machine_id}
            ]
        })
        
        if machine:
            # Convert ObjectId to string
            if '_id' in machine:
                machine['_id'] = str(machine['_id'])
            return machine
        return None
    except Exception as e:
        logging.warning(f"MongoDB machine fetch failed: {e}")
        return None


# ==================== Report Data Endpoint ====================
@router.get("/reports/data/{machine_id}")
async def get_report_data(
    machine_id: str,
    bearing_id: Optional[str] = Query(None, description="Specific bearing ID for single-bearing report"),
    machine_class: Optional[str] = Query("II", description="ISO machine class: I, II, III, IV"),
    data_type: Optional[str] = Query("OFFLINE", description="Data type: ONLINE or OFFLINE")
):
    """
    Get complete report data with FFT analysis for all bearings.
    
    This endpoint prepares all the data needed for a report using the
    new FFT analysis logic (velocity_convert, perform_complete_analysis).
    
    Returns JSON with:
    - Machine details
    - Bearings with FFT spectrum, severity, and diagnosis for each axis
    """
    logging.info(f"[Report API] Fetching report data for machine {machine_id}")
    
    try:
        # Try to get machine from database
        machine_data = await fetch_machine_from_db(machine_id)
        
        # Get bearings (from database or API)
        bearings = None
        if machine_data and 'bearings' in machine_data:
            bearings = machine_data.get('bearings', [])
        
        if not bearings:
            bearings = await fetch_bearings_for_machine(machine_id)
        
        # Prepare report data with FFT analysis
        report_data = await prepare_report_data(
            machine_id=machine_id,
            machine_data=machine_data,
            bearings=bearings,
            bearing_id=bearing_id,
            machine_class=machine_class,
            data_type=data_type
        )
        
        return report_data
        
    except Exception as e:
        logging.exception(f"Failed to get report data for {machine_id}")
        raise HTTPException(status_code=500, detail=f"Failed to get report data: {str(e)}")


# ==================== PDF Generation Endpoint ====================
@router.get("/reports/pdf/{machine_id}")
async def generate_pdf(
    machine_id: str,
    bearing_id: Optional[str] = Query(None, description="Specific bearing ID for single-bearing report"),
    machine_class: Optional[str] = Query("II", description="ISO machine class: I, II, III, IV"),
    data_type: Optional[str] = Query("OFFLINE", description="Data type: ONLINE or OFFLINE"),
    include_charts: Optional[bool] = Query(True, description="Include FFT charts in PDF")
):
    """
    Generate and download a PDF report with FFT analysis.
    
    Uses the new FFT analysis logic for proper signal processing:
    - Butterworth highpass filtering
    - Hanning window
    - Overlapping block FFT with averaging
    - Velocity RMS calculation
    - ISO 10816-3 severity assessment
    """
    logging.info(f"[Report API] Generating PDF for machine {machine_id}")
    
    try:
        # Try to get machine from database
        machine_data = await fetch_machine_from_db(machine_id)
        
        # Get bearings
        bearings = None
        if machine_data and 'bearings' in machine_data:
            bearings = machine_data.get('bearings', [])
        
        if not bearings:
            bearings = await fetch_bearings_for_machine(machine_id)
        
        # Generate PDF
        pdf_buffer = await generate_report(
            machine_id=machine_id,
            machine_data=machine_data,
            bearings=bearings,
            bearing_id=bearing_id,
            machine_class=machine_class,
            data_type=data_type,
            include_charts=include_charts
        )
        
        # Create filename
        machine_name = 'Machine'
        if machine_data:
            machine_name = machine_data.get('name') or machine_data.get('machineName') or machine_id
        
        # Clean filename
        safe_name = "".join(c for c in machine_name if c.isalnum() or c in (' ', '-', '_')).strip()[:30]
        date_str = datetime.now().strftime('%Y-%m-%d')
        filename = f"Report_{safe_name}_{date_str}.pdf"
        
        return StreamingResponse(
            pdf_buffer,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )
        
    except Exception as e:
        logging.exception(f"Failed to generate PDF for {machine_id}")
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF: {str(e)}")
