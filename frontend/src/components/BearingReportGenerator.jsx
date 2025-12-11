import React, { useState } from 'react';
import jsPDF from 'jspdf';
import { FileText, Loader2 } from 'lucide-react';
import { fetchMachineBearingData } from '../services/api';

// Company logo as base64 (will be loaded dynamically)
let companyLogoBase64 = null;

// Load logo on component mount
const loadLogo = async () => {
  if (companyLogoBase64) return companyLogoBase64;
  try {
    const response = await fetch('/company_logo.jpg');
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        companyLogoBase64 = reader.result;
        resolve(companyLogoBase64);
      };
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('Could not load company logo:', e);
    return null;
  }
};

// Convert raw time-domain data to frequency-amplitude pairs for FFT display
const convertRawDataToFFT = (rawData, sampleRate = 20000) => {
  if (!rawData || rawData.length === 0) return [];
  
  // If data is already in frequency-amplitude format, return as-is
  if (typeof rawData[0] === 'object' && (rawData[0].frequency !== undefined || rawData[0].freq !== undefined)) {
    return rawData.map((point, idx) => ({
      frequency: point.frequency || point.freq || point.x || idx * 10,
      amplitude: Math.abs(point.amplitude || point.value || point.y || point.amp || 0)
    }));
  }
  
  // Raw data is array of amplitude values - convert to frequency-amplitude pairs
  const n = rawData.length;
  const freqResolution = sampleRate / n;
  const numPoints = Math.min(Math.floor(n / 2), 500);
  const result = [];
  
  for (let i = 0; i < numPoints; i++) {
    const freq = i * freqResolution;
    const amp = Math.abs(rawData[i] || 0);
    result.push({ frequency: freq, amplitude: amp });
  }
  
  return result;
};

// Fetch real bearing FFT data from API
const fetchBearingFFTData = async (machineId, bearingId, axis, machineType) => {
  try {
    const date = new Date().toISOString().split('T')[0];
    const response = await fetchMachineBearingData(machineId, bearingId, {
      date: date,
      axis: `${axis}-Axis`,
      data_type: machineType || 'OFFLINE',
      analytics_type: 'MF'
    });
    
    if (response && response.data) {
      const rawData = response.data.rowdata || response.data.rawData || response.data.fftData || [];
      return convertRawDataToFFT(rawData);
    }
  } catch (err) {
    console.warn(`Failed to fetch FFT data for bearing ${bearingId} ${axis}:`, err);
  }
  return [];
};

// Severity Level Colors
const SEVERITY_COLORS = {
  A: { bg: [16, 185, 129], text: 'Normal', level: 1 },
  B: { bg: [6, 182, 212], text: 'Satisfactory', level: 2 },
  C: { bg: [245, 158, 11], text: 'Alert', level: 3 },
  D: { bg: [239, 68, 68], text: 'Unacceptable', level: 4 }
};

// No random FFT generation - only use real data from API

const BearingReportGenerator = ({ machine, bearing, bearings = [], isSingleBearing = false }) => {
  const [loading, setLoading] = useState(false);

  const getStatusSeverity = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'normal') return 'A';
    if (s === 'satisfactory') return 'B';
    if (s === 'alert') return 'C';
    if (s === 'unacceptable' || s === 'unsatisfactory') return 'D';
    return 'A';
  };

  const getVelocityColor = (vel) => {
    const v = parseFloat(vel);
    if (v > 7.1) return [239, 68, 68];
    if (v > 4.5) return [251, 146, 60];
    if (v > 2.8) return [245, 158, 11];
    return [16, 185, 129];
  };

  const drawPageHeader = (pdf, logo, machineName, pageWidth, margin) => {
    pdf.setFillColor(30, 41, 59);
    pdf.rect(0, 0, pageWidth, 22, 'F');
    
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('AAMS', margin, 14);
    
    if (machineName) {
      pdf.setFontSize(10);
      pdf.text(machineName, pageWidth / 2, 14, { align: 'center' });
    }
    
    if (logo) {
      try {
        pdf.addImage(logo, 'JPEG', pageWidth - margin - 25, 2, 23, 18);
      } catch (e) {
        console.warn('Failed to add logo:', e);
      }
    }
  };

  const drawPageFooter = (pdf, pageNum, pageWidth, pageHeight, margin) => {
    pdf.setFontSize(8);
    pdf.setTextColor(79, 70, 229);
    pdf.text('http://app.aams.io', margin, pageHeight - 8);
    pdf.setTextColor(100, 100, 100);
    pdf.text(`Page: ${pageNum}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  };

  const drawFFTChart = (pdf, fftData, x, y, width, height, title, color) => {
    pdf.setFillColor(250, 250, 250);
    pdf.rect(x, y, width, height, 'F');
    
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.3);
    pdf.rect(x, y, width, height, 'S');
    
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30, 41, 59);
    pdf.text(title, x + 5, y - 3);
    
    pdf.setDrawColor(230, 230, 230);
    pdf.setLineWidth(0.1);
    
    for (let i = 1; i < 5; i++) {
      const gridY = y + (height / 5) * i;
      pdf.line(x, gridY, x + width, gridY);
    }
    
    for (let i = 1; i < 10; i++) {
      const gridX = x + (width / 10) * i;
      pdf.line(gridX, y, gridX, y + height);
    }
    
    if (fftData && fftData.length > 0) {
      pdf.setDrawColor(...color);
      pdf.setLineWidth(0.5);
      
      const maxAmplitude = Math.max(...fftData.map(d => d.amplitude)) || 1;
      const scaleX = width / fftData.length;
      const scaleY = (height - 10) / maxAmplitude;
      
      for (let i = 1; i < fftData.length; i++) {
        const x1 = x + (i - 1) * scaleX;
        const y1 = y + height - 5 - fftData[i - 1].amplitude * scaleY;
        const x2 = x + i * scaleX;
        const y2 = y + height - 5 - fftData[i].amplitude * scaleY;
        pdf.line(x1, y1, x2, y2);
      }
    }
    
    pdf.setFontSize(7);
    pdf.setTextColor(100, 100, 100);
    pdf.text('Frequency (Hz)', x + width / 2, y + height + 5, { align: 'center' });
    pdf.text('Vel', x - 3, y + height / 2, { angle: 90 });
    
    pdf.setFontSize(6);
    pdf.text('0', x, y + height + 3);
    pdf.text('500', x + width / 2, y + height + 3, { align: 'center' });
    pdf.text('1000', x + width, y + height + 3, { align: 'right' });
  };

  const generatePDFReport = async () => {
    if (!machine) return;
    
    setLoading(true);

    try {
      const logo = await loadLogo();
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const contentWidth = pageWidth - 2 * margin;
      
      const machineName = machine.name || machine.machineName || 'Unknown Machine';
      const status = (machine.statusName || machine.status || 'normal').toLowerCase();
      const severity = getStatusSeverity(status);
      const statusColor = SEVERITY_COLORS[severity];
      
      // Determine which bearings to include
      const bearingsToReport = isSingleBearing && bearing ? [bearing] : bearings;
      
      let pageNum = 1;
      let yPos = 0;

      // ==================== PAGE 1: Bearing Details ====================
      drawPageHeader(pdf, logo, machineName, pageWidth, margin);
      yPos = 26;
      
      // Title
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text(isSingleBearing ? 'BEARING ANALYSIS REPORT' : 'MACHINE & BEARING REPORT', pageWidth / 2, yPos, { align: 'center' });
      
      yPos += 10;
      
      // Status row
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(30, 41, 59);
      pdf.text('Status: ', margin, yPos);
      pdf.setTextColor(...statusColor.bg);
      pdf.setFont('helvetica', 'bold');
      pdf.text(status.toUpperCase(), margin + 15, yPos);
      
      pdf.setTextColor(100, 100, 100);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Report Date: ${new Date().toLocaleDateString()}`, pageWidth - margin, yPos, { align: 'right' });
      
      yPos += 10;
      
      // Machine Details
      pdf.setFillColor(248, 250, 252);
      pdf.rect(margin, yPos, contentWidth, 30, 'F');
      pdf.setDrawColor(226, 232, 240);
      pdf.rect(margin, yPos, contentWidth, 30, 'S');
      
      const details = [
        { label: 'Machine Name', value: machineName },
        { label: 'Machine ID', value: machine.machineId || machine._id || 'N/A' },
        { label: 'Customer ID', value: machine.customerId || 'N/A' },
        { label: 'Area ID', value: machine.areaId || 'N/A' },
        { label: 'Type', value: machine.type || 'OFFLINE' },
        { label: 'Standard', value: 'ISO 10816-3' }
      ];
      
      const colWidth = contentWidth / 2;
      details.forEach((detail, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = margin + col * colWidth + 5;
        const y = yPos + 8 + row * 8;
        
        pdf.setTextColor(100, 100, 100);
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.text(detail.label + ':', x, y);
        
        pdf.setTextColor(30, 41, 59);
        pdf.setFont('helvetica', 'bold');
        pdf.text(detail.value, x + 30, y);
      });
      
      yPos += 38;
      
      // Bearing List Table
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(30, 41, 59);
      pdf.text(`Bearings (${bearingsToReport.length})`, margin, yPos);
      
      yPos += 6;
      
      // Table header
      const tableHeaders = ['Bearing ID', 'Status', 'Vel (mm/s)', 'Acc (g)', 'Temp (C)'];
      const colWidths = [60, 30, 30, 30, 30];
      const rowHeight = 7;
      
      pdf.setFillColor(30, 41, 59);
      let tableX = margin;
      colWidths.forEach((w, i) => {
        pdf.rect(tableX, yPos, w, rowHeight, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'bold');
        pdf.text(tableHeaders[i], tableX + 2, yPos + 5);
        tableX += w;
      });
      
      yPos += rowHeight;
      
      // Table rows
      bearingsToReport.forEach((b, bIdx) => {
        const bearingId = b._id || b.bearingId || `Bearing-${bIdx + 1}`;
        const bearingStatus = (b.statusName || b.status || 'satisfactory').toLowerCase();
        // Use real data from bearing or show '-' if not available
        const vel = b.velocity_rms?.toFixed(2) || b.vel?.toFixed(2) || '-';
        const acc = b.acceleration_rms?.toFixed(3) || b.acc?.toFixed(3) || '-';
        const temp = b.temperature?.toFixed(1) || b.temp?.toFixed(1) || '-';
        
        tableX = margin;
        const rowData = [bearingId.substring(0, 25), bearingStatus, vel, acc, temp];
        const bgColor = bIdx % 2 === 0 ? [255, 255, 255] : [248, 250, 252];
        
        colWidths.forEach((w, i) => {
          pdf.setFillColor(...bgColor);
          pdf.rect(tableX, yPos, w, rowHeight, 'F');
          pdf.setDrawColor(226, 232, 240);
          pdf.rect(tableX, yPos, w, rowHeight, 'S');
          
          if (i === 2) {
            const velColor = getVelocityColor(rowData[i]);
            pdf.setTextColor(...velColor);
          } else if (i === 1) {
            const sevColor = SEVERITY_COLORS[getStatusSeverity(bearingStatus)];
            pdf.setTextColor(...sevColor.bg);
          } else {
            pdf.setTextColor(30, 41, 59);
          }
          
          pdf.setFontSize(7);
          pdf.setFont('helvetica', 'normal');
          pdf.text(rowData[i], tableX + 2, yPos + 5);
          tableX += w;
        });
        
        yPos += rowHeight;
      });

      drawPageFooter(pdf, pageNum, pageWidth, pageHeight, margin);
      pageNum++;
      
      // ==================== FFT Charts Pages ====================
      const chartColors = {
        H: [59, 130, 246],
        V: [16, 185, 129],
        A: [245, 158, 11]
      };
      
      const machineId = machine.machineId || machine._id;
      const machineType = machine.type || 'OFFLINE';
      
      let chartIndex = 0;
      for (const b of bearingsToReport) {
        const bearingId = b._id || b.bearingId || 'Bearing';
        
        for (const axis of ['H', 'V', 'A']) {
          if (chartIndex % 2 === 0) {
            pdf.addPage();
            yPos = 0;
            drawPageHeader(pdf, logo, machineName, pageWidth, margin);
            yPos = 28;
            
            pdf.setTextColor(30, 41, 59);
            pdf.setFontSize(9);
            pdf.text(`Bearing: ${bearingId.substring(0, 40)}`, margin, yPos);
            yPos += 8;
          }
          
          const chartTitle = `FFT Spectrum - Velocity > (${axis}-Axis)`;
          const chartYPos = chartIndex % 2 === 0 ? 45 : 145;
          
          // Fetch real FFT data from API
          const fftData = await fetchBearingFFTData(machineId, bearingId, axis, machineType);
          
          if (fftData && fftData.length > 0) {
            drawFFTChart(
              pdf, 
              fftData, 
              margin + 5, 
              chartYPos, 
              contentWidth - 10, 
              80, 
              chartTitle,
              chartColors[axis]
            );
          } else {
            // No data available - draw empty chart with message
            pdf.setFillColor(250, 250, 250);
            pdf.rect(margin + 5, chartYPos, contentWidth - 10, 80, 'F');
            pdf.setDrawColor(200, 200, 200);
            pdf.rect(margin + 5, chartYPos, contentWidth - 10, 80, 'S');
            pdf.setFontSize(9);
            pdf.setTextColor(100, 100, 100);
            pdf.text('No FFT data available from API', margin + contentWidth / 2, chartYPos + 40, { align: 'center' });
            pdf.setFontSize(9);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(30, 41, 59);
            pdf.text(chartTitle, margin + 10, chartYPos - 3);
          }
          
          pdf.setFontSize(7);
          pdf.setTextColor(100, 100, 100);
          pdf.text(`Date: ${new Date().toISOString().split('T')[0]}`, margin + 5, chartYPos + 90);
          
          chartIndex++;
          
          if (chartIndex % 2 === 0 || chartIndex === bearingsToReport.length * 3) {
            drawPageFooter(pdf, pageNum, pageWidth, pageHeight, margin);
            pageNum++;
          }
        }
      }
      
      // Open PDF in new tab and trigger download
      const bearingName = isSingleBearing && bearing ? 
        (bearing._id || bearing.bearingId || 'bearing').substring(0, 20) : 
        'all_bearings';
      const fileName = `Report_${machineName.replace(/[^a-zA-Z0-9()-]/g, '_')}_${bearingName}_${new Date().toISOString().split('T')[0]}.pdf`;
      
      // Get PDF as blob and create object URL
      const pdfBlob = pdf.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      
      // Open in new tab
      const newTab = window.open(pdfUrl, '_blank');
      
      if (!newTab || newTab.closed || typeof newTab.closed === 'undefined') {
        // Fallback: direct download
        const link = document.createElement('a');
        link.href = pdfUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        // Trigger download in new tab
        setTimeout(() => {
          try {
            const link = newTab.document.createElement('a');
            link.href = pdfUrl;
            link.download = fileName;
            newTab.document.body.appendChild(link);
            link.click();
          } catch (e) {
            console.log('Download triggered via new tab view');
          }
        }, 500);
      }
      
    } catch (error) {
      console.error('Report generation failed:', error);
      alert('Failed to generate report. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={generatePDFReport}
      disabled={loading || !machine}
      className={`btn ${isSingleBearing ? 'btn-secondary btn-sm' : 'btn-primary'}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        opacity: (!machine || loading) ? 0.6 : 1,
        cursor: (!machine || loading) ? 'not-allowed' : 'pointer'
      }}
    >
      {loading ? (
        <>
          <Loader2 size={14} className="spinning" />
          Generating...
        </>
      ) : (
        <>
          <FileText size={14} />
          Download Report
        </>
      )}
    </button>
  );
};

export default BearingReportGenerator;
