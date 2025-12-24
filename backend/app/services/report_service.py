"""
Report Generation Service

Generates comprehensive PDF reports for machine vibration analysis.
Uses the FFT analysis functions from fft_analysis.py for signal processing.
"""

import io
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
import httpx

# PDF generation
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

# Chart generation
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
import numpy as np

# Import FFT analysis functions
try:
    from app.services.fft_analysis import (
        velocity_convert,
        perform_complete_analysis,
        get_iso_severity_zone,
        ISO_THRESHOLDS,
        ZONE_LABELS,
        ZONE_COLORS
    )
except ImportError:
    from services.fft_analysis import (
        velocity_convert,
        perform_complete_analysis,
        get_iso_severity_zone,
        ISO_THRESHOLDS,
        ZONE_LABELS,
        ZONE_COLORS
    )

# External API URLs
DATA_URL = "https://srcapiv2.aams.io/AAMS/AI/Data"
BEARING_URL = "https://srcapiv2.aams.io/AAMS/AI/BearingLocation"
HEADERS = {'Content-Type': 'application/json'}


# ==========================================
# SEVERITY COLORS FOR PDF
# ==========================================
SEVERITY_PDF_COLORS = {
    'A': colors.HexColor('#10b981'),  # Green - Normal
    'B': colors.HexColor('#06b6d4'),  # Cyan - Satisfactory
    'C': colors.HexColor('#f59e0b'),  # Orange - Alert
    'D': colors.HexColor('#ef4444'),  # Red - Unacceptable
}


def get_status_severity(status: str) -> str:
    """Map status name to severity zone."""
    s = (status or '').lower()
    if s == 'normal':
        return 'A'
    if s == 'satisfactory':
        return 'B'
    if s == 'alert':
        return 'C'
    if s in ['unacceptable', 'unsatisfactory']:
        return 'D'
    return 'A'


def get_velocity_color(vel: float) -> colors.Color:
    """Get color based on velocity value."""
    if vel > 7.1:
        return colors.HexColor('#ef4444')  # Red
    if vel > 4.5:
        return colors.HexColor('#fb923c')  # Orange
    if vel > 2.8:
        return colors.HexColor('#f59e0b')  # Yellow
    return colors.HexColor('#10b981')  # Green


async def fetch_bearing_data_for_report(
    machine_id: str,
    bearing_id: str,
    axis: str,
    data_type: str = "OFFLINE"
) -> Optional[Dict]:
    """
    Fetch raw vibration data for a bearing axis from external API.
    
    Returns dict with rawData, rpm, SR or None if fetch fails.
    """
    payload = {
        "machineId": machine_id,
        "bearingLocationId": bearing_id,
        "Axis_Id": axis,
        "type": data_type,
        "Analytics_Types": "MF"
    }
    
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(DATA_URL, headers=HEADERS, json=payload)
            if response.status_code == 200:
                return response.json()
    except Exception as e:
        logging.warning(f"Failed to fetch data for {bearing_id} {axis}: {e}")
    
    return None


async def fetch_bearings_for_machine(machine_id: str) -> List[Dict]:
    """Fetch bearings list for a machine from external API."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                BEARING_URL, 
                headers=HEADERS, 
                json={"machineId": machine_id}
            )
            if response.status_code == 200:
                return response.json()
    except Exception as e:
        logging.warning(f"Failed to fetch bearings for {machine_id}: {e}")
    
    return []


def create_fft_chart(fft_data: List[Dict], title: str, color: str = '#3b82f6') -> io.BytesIO:
    """
    Create an FFT spectrum chart as PNG image.
    
    Args:
        fft_data: List of {frequency, amplitude} dicts
        title: Chart title
        color: Line color hex
        
    Returns:
        BytesIO buffer containing PNG image
    """
    fig, ax = plt.subplots(figsize=(6, 2.5), dpi=100)
    
    if fft_data and len(fft_data) > 0:
        frequencies = [d.get('frequency', 0) for d in fft_data]
        amplitudes = [d.get('amplitude', 0) for d in fft_data]
        
        ax.plot(frequencies, amplitudes, color=color, linewidth=0.8)
        ax.fill_between(frequencies, amplitudes, alpha=0.2, color=color)
        
        ax.set_xlabel('Frequency (Hz)', fontsize=8)
        ax.set_ylabel('Velocity (mm/s)', fontsize=8)
    else:
        ax.text(0.5, 0.5, 'No data available', ha='center', va='center', 
                fontsize=10, color='gray', transform=ax.transAxes)
    
    ax.set_title(title, fontsize=9, fontweight='bold')
    ax.grid(True, alpha=0.3)
    ax.tick_params(axis='both', labelsize=7)
    
    # Set y-axis to start at 0
    ax.set_ylim(bottom=0)
    
    plt.tight_layout()
    
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', dpi=100)
    plt.close(fig)
    buf.seek(0)
    
    return buf


async def prepare_report_data(
    machine_id: str,
    machine_data: Optional[Dict] = None,
    bearings: Optional[List[Dict]] = None,
    bearing_id: Optional[str] = None,
    machine_class: str = 'II',
    data_type: str = 'OFFLINE'
) -> Dict[str, Any]:
    """
    Prepare all data needed for report generation using new FFT logic.
    
    Args:
        machine_id: Machine ID
        machine_data: Optional pre-fetched machine data
        bearings: Optional pre-fetched bearings list
        bearing_id: Optional specific bearing ID (for single bearing report)
        machine_class: ISO machine class (I, II, III, IV)
        data_type: ONLINE or OFFLINE
        
    Returns:
        Dict containing all report data including FFT analysis results
    """
    logging.info(f"[ReportService] Preparing report data for machine {machine_id}")
    
    # Fetch bearings if not provided
    if bearings is None:
        bearings = await fetch_bearings_for_machine(machine_id)
    
    # Filter to specific bearing if requested
    if bearing_id:
        bearings = [b for b in bearings if b.get('_id') == bearing_id or b.get('bearingLocationId') == bearing_id]
    
    if not bearings:
        logging.warning(f"No bearings found for machine {machine_id}")
        return {
            'machine': machine_data or {'machineId': machine_id},
            'bearings': [],
            'reportDate': datetime.now().isoformat(),
            'error': 'No bearings found'
        }
    
    # Process each bearing with FFT analysis
    bearings_data = []
    axes = ['H-Axis', 'V-Axis', 'A-Axis']
    
    for bearing in bearings:
        b_id = bearing.get('_id') or bearing.get('bearingLocationId')
        b_name = bearing.get('name') or bearing.get('bearingName') or b_id
        b_status = bearing.get('statusName') or bearing.get('status') or 'Unknown'
        
        bearing_result = {
            'bearingId': b_id,
            'bearingName': b_name,
            'status': b_status,
            'severity': get_status_severity(b_status),
            'axisData': {}
        }
        
        # Fetch and analyze data for each axis
        for axis in axes:
            axis_short = axis.replace('-Axis', '')
            
            # Fetch raw data from API
            raw_response = await fetch_bearing_data_for_report(
                machine_id, b_id, axis, data_type
            )
            
            if raw_response:
                raw_data = raw_response.get('rawData', [])
                rpm = raw_response.get('rpm')
                sample_rate = raw_response.get('SR', 10000)
                
                # Parse values
                try:
                    sample_rate = float(sample_rate)
                except:
                    sample_rate = 10000.0
                
                try:
                    rpm = float(rpm) if rpm else None
                except:
                    rpm = None
                
                # Parse raw data
                if isinstance(raw_data, str):
                    raw_data = [float(x.strip()) for x in raw_data.split(',') if x.strip()]
                elif isinstance(raw_data, list):
                    parsed = []
                    for x in raw_data:
                        try:
                            parsed.append(float(x) if isinstance(x, (int, float, str)) else 0)
                        except:
                            pass
                    raw_data = parsed
                
                # Perform FFT analysis if we have valid data
                if raw_data and len(raw_data) >= 100 and rpm and rpm > 0:
                    try:
                        analysis = perform_complete_analysis(
                            raw_data=raw_data,
                            sample_rate=sample_rate,
                            rpm=rpm,
                            axis=axis_short,
                            machine_class=machine_class
                        )
                        
                        bearing_result['axisData'][axis_short] = {
                            'available': True,
                            'rpm': rpm,
                            'sampleRate': sample_rate,
                            'fftSpectrum': analysis.get('fftSpectrum', []),
                            'velocityRMS': analysis.get('severity', {}).get('velocityRMS', 0),
                            'severity': analysis.get('severity', {}),
                            'diagnosis': analysis.get('diagnosis', {}),
                            'harmonics': analysis.get('harmonics', []),
                            'peakAt1x': analysis.get('peakAt1x', {})
                        }
                        
                        logging.info(f"[ReportService] {b_id} {axis}: Analysis complete, vRMS={analysis.get('severity', {}).get('velocityRMS', 0):.2f}")
                        
                    except Exception as e:
                        logging.warning(f"FFT analysis failed for {b_id} {axis}: {e}")
                        bearing_result['axisData'][axis_short] = {
                            'available': False,
                            'error': str(e)
                        }
                elif not raw_data or len(raw_data) < 100:
                    # API returned 200 but no data available for this axis
                    bearing_result['axisData'][axis_short] = {
                        'available': False,
                        'error': 'No data available for this axis'
                    }
                    logging.info(f"[ReportService] {b_id} {axis}: No data available (rawData len={len(raw_data) if raw_data else 0})")
                else:
                    bearing_result['axisData'][axis_short] = {
                        'available': False,
                        'error': 'Missing RPM value'
                    }
            else:
                bearing_result['axisData'][axis_short] = {
                    'available': False,
                    'error': 'Failed to fetch data from API'
                }
        
        # Determine overall bearing severity (worst case across axes)
        severity_order = ['A', 'B', 'C', 'D']
        worst_severity = 'A'
        
        for axis_short, axis_data in bearing_result['axisData'].items():
            if axis_data.get('available') and axis_data.get('severity', {}).get('zone'):
                zone = axis_data['severity']['zone']
                if severity_order.index(zone) > severity_order.index(worst_severity):
                    worst_severity = zone
        
        bearing_result['overallSeverity'] = worst_severity
        bearing_result['overallSeverityLabel'] = ZONE_LABELS.get(worst_severity, 'Unknown')
        
        bearings_data.append(bearing_result)
    
    return {
        'machine': machine_data or {'machineId': machine_id},
        'bearings': bearings_data,
        'reportDate': datetime.now().isoformat(),
        'machineClass': machine_class,
        'dataType': data_type
    }


async def generate_pdf_report(
    report_data: Dict[str, Any],
    include_charts: bool = True
) -> io.BytesIO:
    """
    Generate a PDF report from prepared report data.
    
    Args:
        report_data: Data from prepare_report_data()
        include_charts: Whether to include FFT charts
        
    Returns:
        BytesIO buffer containing PDF
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15*mm,
        leftMargin=15*mm,
        topMargin=15*mm,
        bottomMargin=15*mm
    )
    
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'Title',
        parent=styles['Title'],
        fontSize=16,
        spaceAfter=10,
        textColor=colors.HexColor('#1e293b')
    )
    
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=12,
        spaceAfter=6,
        textColor=colors.HexColor('#1e293b')
    )
    
    normal_style = ParagraphStyle(
        'CustomNormal',
        parent=styles['Normal'],
        fontSize=9,
        spaceAfter=4
    )
    
    elements = []
    
    # ==================== HEADER ====================
    machine = report_data.get('machine', {})
    machine_name = machine.get('name') or machine.get('machineName') or machine.get('machineId', 'Unknown')
    machine_id = machine.get('machineId') or machine.get('_id', 'N/A')
    report_date = datetime.now().strftime('%Y-%m-%d %H:%M')
    
    elements.append(Paragraph("VIBRATION ANALYSIS REPORT", title_style))
    elements.append(Spacer(1, 5*mm))
    
    # Machine details table
    machine_info = [
        ['Machine Name:', machine_name, 'Report Date:', report_date],
        ['Machine ID:', machine_id, 'Standard:', 'ISO 10816-3'],
        ['Customer ID:', machine.get('customerId', 'N/A'), 'Area:', machine.get('areaId', 'N/A')],
        ['Data Type:', report_data.get('dataType', 'OFFLINE'), 'Machine Class:', report_data.get('machineClass', 'II')]
    ]
    
    info_table = Table(machine_info, colWidths=[70, 120, 70, 100])
    info_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#1e293b')),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f8fafc')),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 8*mm))
    
    # ==================== ISO SEVERITY LEGEND ====================
    elements.append(Paragraph("Severity Levels (ISO 10816-3)", heading_style))
    
    severity_legend = [
        ['Zone', 'Description', 'Threshold'],
        ['A', 'Normal - Newly commissioned', '< 1.12 mm/s'],
        ['B', 'Satisfactory - Unrestricted long-term operation', '1.12 - 2.8 mm/s'],
        ['C', 'Alert - Restricted operation', '2.8 - 7.1 mm/s'],
        ['D', 'Unacceptable - Immediate action required', '> 7.1 mm/s']
    ]
    
    legend_table = Table(severity_legend, colWidths=[40, 200, 100])
    legend_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 7),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e293b')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('BACKGROUND', (0, 1), (0, 1), SEVERITY_PDF_COLORS['A']),
        ('BACKGROUND', (0, 2), (0, 2), SEVERITY_PDF_COLORS['B']),
        ('BACKGROUND', (0, 3), (0, 3), SEVERITY_PDF_COLORS['C']),
        ('BACKGROUND', (0, 4), (0, 4), SEVERITY_PDF_COLORS['D']),
        ('TEXTCOLOR', (0, 1), (0, -1), colors.white),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    elements.append(legend_table)
    elements.append(Spacer(1, 8*mm))
    
    # ==================== BEARINGS SUMMARY TABLE ====================
    bearings = report_data.get('bearings', [])
    
    if bearings:
        elements.append(Paragraph(f"Bearing Analysis Summary ({len(bearings)} bearings)", heading_style))
        
        # Build table data
        bearing_table_data = [['Bearing ID', 'Status', 'H-Axis', 'V-Axis', 'A-Axis', 'Severity']]
        
        for b in bearings:
            row = [
                b.get('bearingName', b.get('bearingId', 'N/A'))[:25],
                b.get('status', 'N/A'),
            ]
            
            # Add velocity RMS for each axis
            for axis_key in ['H', 'V', 'A']:
                axis_data = b.get('axisData', {}).get(axis_key, {})
                if axis_data.get('available'):
                    vrms = axis_data.get('velocityRMS', 0)
                    row.append(f"{vrms:.2f}")
                else:
                    row.append('-')
            
            row.append(b.get('overallSeverity', 'A'))
            bearing_table_data.append(row)
        
        bearing_table = Table(bearing_table_data, colWidths=[100, 60, 45, 45, 45, 45])
        
        # Build table style
        table_style = [
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 7),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e293b')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
            ('ALIGN', (2, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]
        
        # Color severity cells
        for i, b in enumerate(bearings):
            row_idx = i + 1
            severity = b.get('overallSeverity', 'A')
            if severity in SEVERITY_PDF_COLORS:
                table_style.append(('BACKGROUND', (-1, row_idx), (-1, row_idx), SEVERITY_PDF_COLORS[severity]))
                table_style.append(('TEXTCOLOR', (-1, row_idx), (-1, row_idx), colors.white))
            
            # Alternate row colors
            if row_idx % 2 == 0:
                table_style.append(('BACKGROUND', (0, row_idx), (-2, row_idx), colors.HexColor('#f8fafc')))
        
        bearing_table.setStyle(TableStyle(table_style))
        elements.append(bearing_table)
        elements.append(Spacer(1, 10*mm))
    
    # ==================== FFT CHARTS ====================
    if include_charts and bearings:
        elements.append(PageBreak())
        elements.append(Paragraph("FFT Spectrum Analysis", title_style))
        elements.append(Spacer(1, 5*mm))
        
        axis_colors = {
            'H': '#3b82f6',  # Blue
            'V': '#10b981',  # Green
            'A': '#f59e0b'   # Orange
        }
        
        for b in bearings:
            bearing_name = b.get('bearingName', b.get('bearingId', 'Bearing'))[:40]
            elements.append(Paragraph(f"Bearing: {bearing_name}", heading_style))
            elements.append(Spacer(1, 3*mm))
            
            for axis_key in ['H', 'V', 'A']:
                axis_data = b.get('axisData', {}).get(axis_key, {})
                
                if axis_data.get('available'):
                    fft_spectrum = axis_data.get('fftSpectrum', [])
                    vrms = axis_data.get('velocityRMS', 0)
                    zone = axis_data.get('severity', {}).get('zone', 'A')
                    
                    # Create chart
                    title = f"{axis_key}-Axis FFT Spectrum (Velocity RMS: {vrms:.2f} mm/s, Zone: {zone})"
                    chart_buffer = create_fft_chart(fft_spectrum, title, axis_colors[axis_key])
                    
                    # Add chart to PDF
                    img = Image(chart_buffer, width=170*mm, height=70*mm)
                    elements.append(img)
                    elements.append(Spacer(1, 3*mm))
                else:
                    error = axis_data.get('error', 'No data available')
                    elements.append(Paragraph(f"<i>{axis_key}-Axis: {error}</i>", normal_style))
            
            elements.append(Spacer(1, 5*mm))
    
    # ==================== FOOTER NOTE ====================
    elements.append(Spacer(1, 10*mm))
    footer_note = """
    <para fontSize="7" textColor="#6b7280">
    Report generated by AAMS Vibration Analysis System. Based on ISO 10816-3:2009/Amd 1:2017 standard.
    Severity levels are general guidelines and should be interpreted in context of machine-specific conditions.
    For more information, visit <link href="http://app.aams.io">http://app.aams.io</link>
    </para>
    """
    elements.append(Paragraph(footer_note, normal_style))
    
    # Build PDF
    doc.build(elements)
    buffer.seek(0)
    
    return buffer


async def generate_report(
    machine_id: str,
    machine_data: Optional[Dict] = None,
    bearings: Optional[List[Dict]] = None,
    bearing_id: Optional[str] = None,
    machine_class: str = 'II',
    data_type: str = 'OFFLINE',
    include_charts: bool = True
) -> io.BytesIO:
    """
    Complete report generation pipeline.
    
    Args:
        machine_id: Machine ID
        machine_data: Optional pre-fetched machine data
        bearings: Optional pre-fetched bearings list
        bearing_id: Optional specific bearing ID
        machine_class: ISO machine class
        data_type: ONLINE or OFFLINE
        include_charts: Whether to include FFT charts
        
    Returns:
        BytesIO buffer containing PDF
    """
    # Prepare data with FFT analysis
    report_data = await prepare_report_data(
        machine_id=machine_id,
        machine_data=machine_data,
        bearings=bearings,
        bearing_id=bearing_id,
        machine_class=machine_class,
        data_type=data_type
    )
    
    # Generate PDF
    pdf_buffer = await generate_pdf_report(report_data, include_charts)
    
    return pdf_buffer
