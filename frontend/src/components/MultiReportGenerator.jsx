import React, { useState } from 'react';
import jsPDF from 'jspdf';
import { FileText, Loader2, Download } from 'lucide-react';
import { fetchMachineById, fetchMachineBearingData } from '../services/api';

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

// Severity Level Colors
const SEVERITY_COLORS = {
  A: { bg: [16, 185, 129], text: 'Normal', level: 1 },      // Green
  B: { bg: [6, 182, 212], text: 'Satisfactory', level: 2 }, // Cyan/Blue
  C: { bg: [245, 158, 11], text: 'Alert', level: 3 },       // Orange/Yellow
  D: { bg: [239, 68, 68], text: 'Unacceptable', level: 4 }  // Red
};

// Calculate RMS from raw time-domain data (array of amplitude values)
const calculateRMS = (data) => {
  if (!data || data.length === 0) return null;
  // Handle both array of numbers and array of objects
  const values = data.map(d => {
    if (typeof d === 'number') return d;
    return d.amplitude || d.value || d.y || 0;
  });
  const sumOfSquares = values.reduce((sum, val) => sum + val * val, 0);
  return Math.sqrt(sumOfSquares / values.length);
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
  // Use a simple approach: treat as time-domain samples and create spectrum-like display
  const n = rawData.length;
  const freqResolution = sampleRate / n;
  
  // Take first half of data points for spectrum (Nyquist)
  const numPoints = Math.min(Math.floor(n / 2), 1000); // Limit to 1000 points for performance
  const result = [];
  
  for (let i = 0; i < numPoints; i++) {
    const freq = i * freqResolution;
    // Use absolute value of raw amplitude for display
    const amp = Math.abs(rawData[i] || 0);
    result.push({ frequency: freq, amplitude: amp });
  }
  
  return result;
};

// Extract metrics from API response data
const extractMetricsFromData = (data) => {
  // Check if data has direct metric fields
  if (data.velocity_rms !== undefined || data.vel !== undefined) {
    return {
      vel: data.velocity_rms?.toFixed(2) || data.vel?.toFixed(2) || null,
      acc: data.acceleration_rms?.toFixed(3) || data.acc?.toFixed(3) || null,
      env: data.envelope?.toFixed(3) || data.env?.toFixed(3) || null,
      temp: data.temperature?.toFixed(1) || data.temp?.toFixed(1) || null
    };
  }
  
  // Try to compute RMS from raw data
  const rawData = data.rowdata || data.rawData || data.fftData || [];
  if (rawData.length > 0) {
    const rmsValue = calculateRMS(rawData);
    return {
      vel: rmsValue ? rmsValue.toFixed(2) : null,
      acc: null,
      env: null,
      temp: null
    };
  }
  
  return { vel: null, acc: null, env: null, temp: null };
};

// Fetch real bearing data from API
const fetchRealBearingData = async (machineId, bearings, machineType) => {
  const date = new Date().toISOString().split('T')[0];
  const bearingsData = [];
  
  for (const bearing of bearings) {
    const bearingId = bearing._id || bearing.bearingId;
    const bearingName = bearing.name || bearing.bearingName || bearingId;
    
    // First try to get metrics directly from bearing object
    const bearingMetrics = {
      vel: bearing.velocity_rms?.toFixed?.(2) || bearing.vel?.toFixed?.(2) || null,
      acc: bearing.acceleration_rms?.toFixed?.(3) || bearing.acc?.toFixed?.(3) || null,
      env: bearing.envelope?.toFixed?.(3) || bearing.env?.toFixed?.(3) || null,
      temp: bearing.temperature?.toFixed?.(1) || bearing.temp?.toFixed?.(1) || null
    };
    
    try {
      // Fetch data for each axis
      const axisData = {};
      for (const axis of ['H-Axis', 'V-Axis', 'A-Axis']) {
        try {
          const response = await fetchMachineBearingData(machineId, bearingId, {
            date: date,
            axis: axis,
            data_type: machineType || 'OFFLINE',
            analytics_type: 'MF'
          });
          
          console.log(`[MultiReportGenerator] Response for ${bearingId} ${axis}:`, response);
          
          if (response && response.data) {
            const data = response.data;
            // Extract FFT data from response
            const fftRawData = data.rowdata || data.rawData || data.fftData || [];
            // Try to extract metrics from API response
            const apiMetrics = extractMetricsFromData(data);
            
            // Convert raw data to FFT format for display
            const convertedFFTData = convertRawDataToFFT(fftRawData, bearing.sr || 20000);
            
            axisData[axis.charAt(0)] = {
              vel: apiMetrics.vel || bearingMetrics.vel || '-',
              acc: apiMetrics.acc || bearingMetrics.acc || '-',
              env: apiMetrics.env || bearingMetrics.env || '-',
              temp: apiMetrics.temp || bearingMetrics.temp || '-',
              fftData: convertedFFTData
            };
            console.log(`[MultiReportGenerator] Processed ${axis} data with ${convertedFFTData.length} FFT points`);
          } else {
            // No data from API, use bearing-level metrics
            axisData[axis.charAt(0)] = {
              vel: bearingMetrics.vel || '-',
              acc: bearingMetrics.acc || '-',
              env: bearingMetrics.env || '-',
              temp: bearingMetrics.temp || '-',
              fftData: []
            };
          }
        } catch (axisErr) {
          console.warn(`Failed to fetch ${axis} data for bearing ${bearingId}:`, axisErr);
          axisData[axis.charAt(0)] = {
            vel: bearingMetrics.vel || '-',
            acc: bearingMetrics.acc || '-',
            env: bearingMetrics.env || '-',
            temp: bearingMetrics.temp || '-',
            fftData: []
          };
        }
      }
      
      bearingsData.push({
        bearingId,
        bearingName,
        date,
        status: bearing.statusName || bearing.status || 'satisfactory',
        sr: 20000,
        axisData
      });
    } catch (err) {
      console.warn(`Failed to fetch data for bearing ${bearingId}:`, err);
      bearingsData.push({
        bearingId,
        bearingName,
        date,
        status: bearing.statusName || bearing.status || 'satisfactory',
        sr: 20000,
        axisData: { 
          H: { vel: bearingMetrics.vel || '-', acc: bearingMetrics.acc || '-', env: bearingMetrics.env || '-', temp: bearingMetrics.temp || '-', fftData: [] },
          V: { vel: bearingMetrics.vel || '-', acc: bearingMetrics.acc || '-', env: bearingMetrics.env || '-', temp: bearingMetrics.temp || '-', fftData: [] },
          A: { vel: bearingMetrics.vel || '-', acc: bearingMetrics.acc || '-', env: bearingMetrics.env || '-', temp: bearingMetrics.temp || '-', fftData: [] }
        }
      });
    }
  }
  
  return bearingsData;
};

// Process bearing data for report (use real data only)
const processBearingDataForReport = (bearingsData) => {
  return bearingsData.map(bearing => {
    const metrics = {};
    const fftData = {};
    
    ['H', 'V', 'A'].forEach(axis => {
      if (bearing.axisData && bearing.axisData[axis]) {
        // Use real data
        metrics[axis] = {
          vel: bearing.axisData[axis].vel,
          acc: bearing.axisData[axis].acc,
          env: bearing.axisData[axis].env,
          temp: bearing.axisData[axis].temp
        };
        
        // Process FFT data if available
        if (bearing.axisData[axis].fftData && bearing.axisData[axis].fftData.length > 0) {
          fftData[axis] = bearing.axisData[axis].fftData.map((point, idx) => ({
            freq: point.frequency || point.freq || (idx / bearing.axisData[axis].fftData.length) * 1000,
            amplitude: point.amplitude || point.value || point.amp || 0
          }));
        } else {
          fftData[axis] = []; // Empty FFT when no real data
        }
      } else {
        // No real data available - use placeholder values
        metrics[axis] = {
          vel: '-',
          acc: '-',
          env: '-',
          temp: '-'
        };
        fftData[axis] = []; // Empty FFT when no real data
      }
    });
    
    return {
      bearingName: bearing.bearingName,
      date: bearing.date,
      sr: bearing.sr,
      status: bearing.status,
      metrics,
      fftData
    };
  });
};

// No random FFT generation - only use real data from API

// Return empty array when API fails (no fallback data)
const generateNoDataBearingData = () => {
  return [];
};

// Fetch bearing data for a machine (real API data only)
const getBearingsDataForMachine = async (machine) => {
  try {
    console.log('[MultiReportGenerator] Fetching real data for:', machine.machineId || machine.id);
    const machineResponse = await fetchMachineById(machine.machineId || machine.id);
    
    if (machineResponse && machineResponse.machine) {
      const realBearings = machineResponse.machine.bearings || [];
      
      if (realBearings.length > 0) {
        console.log('[MultiReportGenerator] Found', realBearings.length, 'bearings');
        const rawBearingData = await fetchRealBearingData(
          machine.machineId || machine.id, 
          realBearings,
          machine.type
        );
        return processBearingDataForReport(rawBearingData);
      }
    }
    console.log('[MultiReportGenerator] No real data available');
    return generateNoDataBearingData();
  } catch (err) {
    console.warn('[MultiReportGenerator] Failed to fetch real data:', err);
    return generateNoDataBearingData();
  }
};

const MultiReportGenerator = ({ machines, onClearSelection }) => {
  const [loading, setLoading] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

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
    if (v > 7.1) return [239, 68, 68];    // Red
    if (v > 4.5) return [251, 146, 60];   // Orange
    if (v > 2.8) return [245, 158, 11];   // Yellow
    return [16, 185, 129];                 // Green
  };

  const drawPageHeader = (pdf, logo, machineName, pageWidth, margin) => {
    // Header background
    pdf.setFillColor(30, 41, 59);
    pdf.rect(0, 0, pageWidth, 22, 'F');
    
    // AAMS Logo text
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('AAMS', margin, 14);
    
    // Machine name in center (if provided)
    if (machineName) {
      pdf.setFontSize(10);
      pdf.text(machineName, pageWidth / 2, 14, { align: 'center' });
    }
    
    // Company logo on right
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
    // Chart background
    pdf.setFillColor(250, 250, 250);
    pdf.rect(x, y, width, height, 'F');
    
    // Chart border
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.3);
    pdf.rect(x, y, width, height, 'S');
    
    // Title
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30, 41, 59);
    pdf.text(title, x + 5, y - 3);
    
    // Draw grid lines
    pdf.setDrawColor(230, 230, 230);
    pdf.setLineWidth(0.1);
    
    // Horizontal grid
    for (let i = 1; i < 5; i++) {
      const gridY = y + (height / 5) * i;
      pdf.line(x, gridY, x + width, gridY);
    }
    
    // Vertical grid
    for (let i = 1; i < 10; i++) {
      const gridX = x + (width / 10) * i;
      pdf.line(gridX, y, gridX, y + height);
    }
    
    // Draw FFT data
    if (fftData && fftData.length > 0) {
      pdf.setDrawColor(...color);
      pdf.setLineWidth(0.5);
      
      const maxAmplitude = Math.max(...fftData.map(d => d.amplitude)) || 1;
      const scaleX = width / fftData.length;
      const scaleY = (height - 10) / maxAmplitude;
      
      // Draw as line chart
      for (let i = 1; i < fftData.length; i++) {
        const x1 = x + (i - 1) * scaleX;
        const y1 = y + height - 5 - fftData[i - 1].amplitude * scaleY;
        const x2 = x + i * scaleX;
        const y2 = y + height - 5 - fftData[i].amplitude * scaleY;
        pdf.line(x1, y1, x2, y2);
      }
    } else {
      // Show "No data available" message
      pdf.setFontSize(12);
      pdf.setTextColor(150, 150, 150);
      pdf.text('No data available', x + width / 2, y + height / 2, { align: 'center' });
    }
    
    // X-axis label
    pdf.setFontSize(7);
    pdf.setTextColor(100, 100, 100);
    pdf.text('Frequency (Hz)', x + width / 2, y + height + 5, { align: 'center' });
    
    // Y-axis label
    pdf.text('Vel', x - 3, y + height / 2, { angle: 90 });
    
    // Frequency markers
    pdf.setFontSize(6);
    pdf.text('0', x, y + height + 3);
    pdf.text('500', x + width / 2, y + height + 3, { align: 'center' });
    pdf.text('1000', x + width, y + height + 3, { align: 'right' });
  };

  // Generate a complete report for one machine (exact same format as ReportGenerator)
  const generateMachineReport = async (pdf, machine, logo, startPageNum) => {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const contentWidth = pageWidth - 2 * margin;
    const severity = getStatusSeverity(machine.status);
    
    // Fetch real bearing data from API (with fallback to generated data)
    const bearingsData = await getBearingsDataForMachine(machine);
    
    let pageNum = startPageNum;
    let yPos = 0;

    // ==================== PAGE 1: Severity Levels Reference ====================
    drawPageHeader(pdf, logo, null, pageWidth, margin);
    yPos = 28;
    
    // Title
    pdf.setTextColor(30, 41, 59);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('VIBRATION ANALYSIS REPORT', pageWidth / 2, yPos, { align: 'center' });
    
    yPos += 12;
    
    // Severity Levels Section
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Severity levels', margin, yPos);
    
    yPos += 6;
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(80, 80, 80);
    const severityDesc = 'A Severity level is assigned to each machine based on result of analysis. The severity levels are ranked as follows:';
    pdf.text(severityDesc, margin, yPos);
    
    yPos += 10;
    
    // Severity Level Boxes
    const severityLevels = [
      { code: 'A', level: 1, title: 'Severity level 1:', desc: 'Overall vibration value is within the acceptable range. This level is considered to be normal. No Maintenance action is required.', color: [16, 185, 129] },
      { code: 'B', level: 2, title: 'Severity level 2:', desc: 'This level is considered as satisfactory. Maintenance action may not be necessary. Equipment can be kept under continues operation.', color: [6, 182, 212] },
      { code: 'C', level: 3, title: 'Severity level 3:', desc: "This level is considered 'Unacceptable', there has been an increase in the vibration and indicates problem in the machine. Maintenance action can be taken during equipment availability / Planned shutdown.", color: [245, 158, 11] },
      { code: 'D', level: 4, title: 'Severity level 4:', desc: "This level is considered 'Unacceptable', There has been predominant increases in vibration trend and indicates problem in the equipment. Required immediate Maintenance action.", color: [239, 68, 68] }
    ];
    
    severityLevels.forEach((level) => {
      const boxHeight = 18;
      
      // Color code box
      pdf.setFillColor(...level.color);
      pdf.rect(margin, yPos, 10, boxHeight, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text(level.code, margin + 5, yPos + 11, { align: 'center' });
      
      // Description box
      pdf.setFillColor(248, 250, 252);
      pdf.rect(margin + 10, yPos, contentWidth - 10, boxHeight, 'F');
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.text(level.title, margin + 14, yPos + 6);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      const descLines = pdf.splitTextToSize(level.desc, contentWidth - 20);
      pdf.text(descLines, margin + 14, yPos + 11);
      
      yPos += boxHeight + 3;
    });
    
    yPos += 8;
    
    // Velocity Threshold Section
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30, 41, 59);
    pdf.text('Velocity Threshold Values (ISO 10816-3)', margin, yPos);
    
    yPos += 8;
    
    // Draw ISO 10816-3 velocity threshold chart
    const chartX = margin;
    const chartY = yPos;
    const chartWidth = contentWidth;
    const chartHeight = 55;
    const numRows = 8;
    const numCols = 8;
    const cellWidth = chartWidth / numCols;
    const cellHeight = chartHeight / numRows;
    
    // Velocity levels
    const velocityLevels = [11, 7.1, 4.5, 3.5, 2.8, 2.3, 1.4, 0.71];
    
    // Color patterns for each group (Rigid, Flexible for Groups 1-4)
    const groupColors = [
      // Group 4 (Pumps > 15kW)
      [[16,185,129], [16,185,129], [245,158,11], [245,158,11], [251,146,60], [239,68,68], [239,68,68], [239,68,68]], // Rigid
      [[16,185,129], [16,185,129], [16,185,129], [245,158,11], [245,158,11], [251,146,60], [239,68,68], [239,68,68]], // Flexible
      // Group 3
      [[16,185,129], [16,185,129], [245,158,11], [245,158,11], [251,146,60], [251,146,60], [239,68,68], [239,68,68]],
      [[16,185,129], [16,185,129], [16,185,129], [245,158,11], [245,158,11], [251,146,60], [251,146,60], [239,68,68]],
      // Group 2 (Medium sized Machines)
      [[16,185,129], [16,185,129], [16,185,129], [245,158,11], [245,158,11], [251,146,60], [239,68,68], [239,68,68]],
      [[16,185,129], [16,185,129], [16,185,129], [16,185,129], [245,158,11], [245,158,11], [251,146,60], [239,68,68]],
      // Group 1 (Large Machines)
      [[16,185,129], [16,185,129], [16,185,129], [16,185,129], [245,158,11], [245,158,11], [251,146,60], [239,68,68]],
      [[16,185,129], [16,185,129], [16,185,129], [16,185,129], [16,185,129], [245,158,11], [245,158,11], [251,146,60]]
    ];
    
    // Draw cells
    for (let col = 0; col < numCols; col++) {
      for (let row = 0; row < numRows; row++) {
        const color = groupColors[col][row];
        pdf.setFillColor(...color);
        pdf.rect(chartX + col * cellWidth, chartY + row * cellHeight, cellWidth, cellHeight, 'F');
      }
    }
    
    // Draw grid lines
    pdf.setDrawColor(255, 255, 255);
    pdf.setLineWidth(0.5);
    for (let i = 0; i <= numRows; i++) {
      pdf.line(chartX, chartY + i * cellHeight, chartX + chartWidth, chartY + i * cellHeight);
    }
    for (let i = 0; i <= numCols; i++) {
      pdf.line(chartX + i * cellWidth, chartY, chartX + i * cellWidth, chartY + chartHeight);
    }
    
    // Velocity labels on right
    pdf.setFontSize(6);
    pdf.setTextColor(30, 41, 59);
    velocityLevels.forEach((vel, i) => {
      pdf.text(vel.toString(), chartX + chartWidth + 2, chartY + i * cellHeight + cellHeight / 2 + 1);
    });
    pdf.text('mm/s rms', chartX + chartWidth + 2, chartY + chartHeight + 5);
    
    // Group labels at bottom
    yPos = chartY + chartHeight + 3;
    pdf.setFontSize(5);
    const groupLabels = ['Rigid', 'Flex', 'Rigid', 'Flex', 'Rigid', 'Flex', 'Rigid', 'Flex'];
    groupLabels.forEach((label, i) => {
      pdf.text(label, chartX + i * cellWidth + cellWidth / 2, yPos, { align: 'center' });
    });
    
    yPos += 4;
    pdf.setFontSize(6);
    pdf.text('Group 4', chartX + cellWidth, yPos, { align: 'center' });
    pdf.text('Group 3', chartX + cellWidth * 3, yPos, { align: 'center' });
    pdf.text('Group 2', chartX + cellWidth * 5, yPos, { align: 'center' });
    pdf.text('Group 1', chartX + cellWidth * 7, yPos, { align: 'center' });
    
    yPos += 4;
    pdf.setFontSize(5);
    pdf.text('Pumps > 15kW', chartX + cellWidth, yPos, { align: 'center' });
    pdf.text('Medium Machines', chartX + cellWidth * 5, yPos, { align: 'center' });
    pdf.text('Large Machines', chartX + cellWidth * 7, yPos, { align: 'center' });
    
    yPos += 10;
    
    // Footer note
    pdf.setFontSize(7);
    pdf.setTextColor(80, 80, 80);
    const footerNote = 'Based on ISO standard 10816-3:2009/amd1:2017, Vibration severity is classified into level 1, level 2, level 3 and level 4. It is general guidelines for the acceptable vibration will be set for each machine mainly based on comparative method or by trending over by the period of time as the operating parameters and condition are different for different machines.';
    const footerLines = pdf.splitTextToSize(footerNote, contentWidth);
    pdf.text(footerLines, margin, yPos);
    
    // Legend
    yPos += 15;
    pdf.setFontSize(6);
    const legendItems = [
      { code: 'A', text: 'Newly Commissioned', color: [16, 185, 129] },
      { code: 'B', text: 'Unrestricted long-term operation', color: [6, 182, 212] },
      { code: 'C', text: 'Restricted long-term operation', color: [245, 158, 11] },
      { code: 'D', text: 'Vibration causes damage', color: [239, 68, 68] }
    ];
    
    legendItems.forEach((item, i) => {
      const lx = margin + (i % 2) * (contentWidth / 2);
      const ly = yPos + Math.floor(i / 2) * 6;
      pdf.setFillColor(...item.color);
      pdf.rect(lx, ly - 3, 8, 4, 'F');
      pdf.setTextColor(30, 41, 59);
      pdf.text(`${item.code}  ${item.text}`, lx + 10, ly);
    });

    drawPageFooter(pdf, pageNum, pageWidth, pageHeight, margin);
    pageNum++;
    
    // ==================== PAGE 2: Machine Details ====================
    pdf.addPage();
    yPos = 0;
    
    drawPageHeader(pdf, logo, machine.machineName || machine.name, pageWidth, margin);
    yPos = 26;
    
    // Status and Date row
    const statusColor = SEVERITY_COLORS[severity];
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(30, 41, 59);
    pdf.text('Status: ', margin, yPos);
    pdf.setTextColor(...statusColor.bg);
    pdf.setFont('helvetica', 'bold');
    pdf.text((machine.status || 'Normal').toUpperCase(), margin + 15, yPos);
    
    pdf.setTextColor(100, 100, 100);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Report Date: ${new Date().toLocaleDateString()}`, pageWidth - margin, yPos, { align: 'right' });
    
    yPos += 8;
    
    // Area Name
    pdf.setTextColor(30, 41, 59);
    pdf.setFontSize(10);
    pdf.text(`Area Name: ${machine.areaId || 'N/A'}`, margin, yPos);
    
    yPos += 10;
    
    // Machine Details Grid
    pdf.setFillColor(248, 250, 252);
    pdf.rect(margin, yPos, contentWidth, 35, 'F');
    pdf.setDrawColor(226, 232, 240);
    pdf.rect(margin, yPos, contentWidth, 35, 'S');
    
    const details = [
      { label: 'Machine Code', value: machine.machineId || machine.id || 'N/A' },
      { label: 'Manufacturer', value: machine.manufacturer || machine.machineName || 'N/A' },
      { label: 'Model', value: machine.model || machine.type || 'N/A' },
      { label: 'Customer ID', value: machine.customerId || 'N/A' },
      { label: 'Area ID', value: machine.areaId || 'N/A' },
      { label: 'Manufacture Year', value: machine.year || '-' }
    ];
    
    const colWidth = contentWidth / 2;
    details.forEach((detail, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = margin + col * colWidth + 5;
      const y = yPos + 8 + row * 10;
      
      pdf.setTextColor(100, 100, 100);
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      pdf.text(detail.label, x, y);
      
      pdf.setTextColor(30, 41, 59);
      pdf.setFont('helvetica', 'bold');
      pdf.text(String(detail.value), x + 35, y);
    });
    
    yPos += 45;
    
    // Observation and Recommendation side by side
    const boxWidth = (contentWidth - 5) / 2;
    const boxHeight = 55;
    
    // Observation Box
    pdf.setFillColor(240, 253, 244);
    pdf.rect(margin, yPos, boxWidth, boxHeight, 'F');
    pdf.setDrawColor(16, 185, 129);
    pdf.setLineWidth(0.5);
    pdf.rect(margin, yPos, boxWidth, boxHeight, 'S');
    
    pdf.setFillColor(16, 185, 129);
    pdf.rect(margin, yPos, boxWidth, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Observation', margin + 3, yPos + 6);
    
    pdf.setTextColor(30, 41, 59);
    pdf.setFontSize(7);
    pdf.setFont('helvetica', 'normal');
    
    const statusZone = severity === 'D' ? 'CRITICAL' : severity === 'C' ? 'ALERT' : 'NORMAL';
    const observations = [
      `• The overall vibration amplitude of the motor`,
      `  bearings are within ${statusZone} zone.`,
      `• Motor DE bearing showing ${severity === 'A' ? 'normal' : 'elevated'} levels.`,
      `• FFT spectrum analysis indicates ${severity === 'D' ? 'bearing defect' : severity === 'C' ? 'developing issue' : 'healthy condition'}.`,
      `• Temperature readings are within limits.`,
      `• Note: ${machine.type || 'OFFLINE'} measurement.`
    ];
    
    observations.forEach((obs, i) => {
      pdf.text(obs, margin + 3, yPos + 14 + i * 6);
    });
    
    // Recommendation Box
    const recX = margin + boxWidth + 5;
    const recColor = severity === 'D' ? [254, 242, 242] : severity === 'C' ? [255, 251, 235] : [240, 253, 244];
    const recBorderColor = severity === 'D' ? [239, 68, 68] : severity === 'C' ? [245, 158, 11] : [16, 185, 129];
    
    pdf.setFillColor(...recColor);
    pdf.rect(recX, yPos, boxWidth, boxHeight, 'F');
    pdf.setDrawColor(...recBorderColor);
    pdf.rect(recX, yPos, boxWidth, boxHeight, 'S');
    
    pdf.setFillColor(...recBorderColor);
    pdf.rect(recX, yPos, boxWidth, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Recommendation', recX + 3, yPos + 6);
    
    pdf.setTextColor(30, 41, 59);
    pdf.setFontSize(7);
    pdf.setFont('helvetica', 'normal');
    
    let recommendations = [];
    if (severity === 'A') {
      recommendations = [
        '• Continue regular maintenance schedule.',
        '• No immediate action required.',
        '• Next scheduled inspection: 90 days.',
        '• Equipment can be kept under continuous',
        '  operation.'
      ];
    } else if (severity === 'B') {
      recommendations = [
        '• Monitor for any changes in performance.',
        '• Schedule routine inspection within 30 days.',
        '• Equipment can continue operation.',
        '• Review lubrication schedule.'
      ];
    } else if (severity === 'C') {
      recommendations = [
        '• Schedule inspection within 7 days.',
        '• Check for unusual vibrations or sounds.',
        '• Maintenance action during planned shutdown.',
        '• Inspect motor bearings for abnormalities.',
        '• Review recent maintenance history.'
      ];
    } else {
      recommendations = [
        '• IMMEDIATE inspection required.',
        '• Consider taking machine offline.',
        '• Contact maintenance team urgently.',
        '• Inspect bearings for defects.',
        '• Replace bearings if defect detected.',
        '• Document all findings.'
      ];
    }
    
    recommendations.forEach((rec, i) => {
      pdf.text(rec, recX + 3, yPos + 14 + i * 6);
    });
    
    yPos += boxHeight + 10;
    
    // Parameters Section
    pdf.setFillColor(248, 250, 252);
    pdf.rect(margin, yPos, contentWidth, 25, 'F');
    pdf.setDrawColor(226, 232, 240);
    pdf.rect(margin, yPos, contentWidth, 25, 'S');
    
    pdf.setTextColor(30, 41, 59);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Parameters', margin + 3, yPos + 6);
    
    pdf.setFontSize(7);
    pdf.setFont('helvetica', 'normal');
    const params = [
      `Motor Type: ${machine.type || 'AC Motor'}`,
      `Power: ${machine.power || '15 kW'}`,
      `Speed: ${machine.speed || '1500 RPM'}`,
      `Standard: ISO 10816-3`
    ];
    params.forEach((param, i) => {
      const px = margin + 3 + (i % 2) * (contentWidth / 2);
      const py = yPos + 14 + Math.floor(i / 2) * 7;
      pdf.text(param, px, py);
    });

    drawPageFooter(pdf, pageNum, pageWidth, pageHeight, margin);
    pageNum++;
    
    // ==================== PAGE 3: Vibration Data Table ====================
    pdf.addPage();
    yPos = 0;
    
    drawPageHeader(pdf, logo, machine.machineName || machine.name, pageWidth, margin);
    yPos = 26;
    
    // Status line
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(30, 41, 59);
    pdf.text('Status: ', margin, yPos);
    pdf.setTextColor(...statusColor.bg);
    pdf.setFont('helvetica', 'bold');
    pdf.text((machine.status || 'Normal').toUpperCase(), margin + 15, yPos);
    
    pdf.setTextColor(100, 100, 100);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Report Date: ${new Date().toLocaleDateString()}`, pageWidth - margin, yPos, { align: 'right' });
    
    yPos += 6;
    pdf.setTextColor(30, 41, 59);
    pdf.text(`Area Name: ${machine.areaId || 'N/A'}`, margin, yPos);
    
    yPos += 10;
    
    // Vibration Data Table
    const tableHeaders = ['Point Name', 'Date', 'Axis', 'Vel (mm/s)', 'Acc (g)', 'Env (gE)', 'Temp (C)'];
    const colWidths = [35, 25, 15, 28, 25, 25, 25];
    const rowHeight = 7;
    
    // Table header
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
    
    // Table data rows - only show if we have real data
    if (bearingsData.length > 0) {
      bearingsData.forEach((bearing, bIdx) => {
        ['H', 'V', 'A'].forEach((axis, aIdx) => {
          tableX = margin;
          const metrics = bearing.metrics[axis];
          const rowData = [
            aIdx === 0 ? bearing.bearingName : '',
            aIdx === 0 ? bearing.date : '',
            axis,
            metrics.vel || 'No data',
            metrics.acc || 'No data',
            metrics.env || 'No data',
            metrics.temp || 'No data'
          ];
          
          const bgColor = bIdx % 2 === 0 ? [255, 255, 255] : [248, 250, 252];
          
          colWidths.forEach((w, i) => {
            pdf.setFillColor(...bgColor);
            pdf.rect(tableX, yPos, w, rowHeight, 'F');
            pdf.setDrawColor(226, 232, 240);
            pdf.rect(tableX, yPos, w, rowHeight, 'S');
            
            // Color code velocity values (only if it's a number)
            if (i === 3 && !isNaN(parseFloat(rowData[i]))) {
              const velColor = getVelocityColor(rowData[i]);
              pdf.setTextColor(...velColor);
            } else if (rowData[i] === 'No data' || rowData[i] === '-') {
              pdf.setTextColor(150, 150, 150);
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
      });
    } else {
      // No data available - show message
      yPos += 20;
      pdf.setFontSize(14);
      pdf.setTextColor(150, 150, 150);
      pdf.text('No vibration data available from API', pageWidth / 2, yPos, { align: 'center' });
      yPos += 10;
      pdf.setFontSize(10);
      pdf.text('Real-time data could not be retrieved for this machine.', pageWidth / 2, yPos, { align: 'center' });
    }

    drawPageFooter(pdf, pageNum, pageWidth, pageHeight, margin);
    pageNum++;
    
    // ==================== PAGE 4+: FFT Charts ====================
    // Generate FFT chart pages only if we have real bearing data
    if (bearingsData.length > 0) {
      const chartColors = {
        H: [59, 130, 246],  // Blue
        V: [16, 185, 129],  // Green
        A: [245, 158, 11]   // Orange
      };
      
      let chartIndex = 0;
      bearingsData.forEach((bearing) => {
        ['H', 'V', 'A'].forEach((axis) => {
          // Start new page every 2 charts
          if (chartIndex % 2 === 0) {
            pdf.addPage();
            yPos = 0;
            drawPageHeader(pdf, logo, machine.machineName || machine.name, pageWidth, margin);
            yPos = 28;
            
            pdf.setTextColor(30, 41, 59);
            pdf.setFontSize(9);
            pdf.text(`Area Name: ${machine.areaId || 'N/A'}`, margin, yPos);
            yPos += 8;
          }
          
          const chartTitle = `FFT Series - ${bearing.bearingName} > Velocity > (${axis}-Axis) > ${bearing.date}`;
          const chartYPos = chartIndex % 2 === 0 ? 45 : 145;
          
          drawFFTChart(
            pdf, 
            bearing.fftData[axis], 
            margin + 5, 
            chartYPos, 
            contentWidth - 10, 
            80, 
            chartTitle,
            chartColors[axis]
          );
          
          // Description
          pdf.setFontSize(7);
          pdf.setTextColor(100, 100, 100);
          pdf.text(`Description: ${bearing.bearingName}-${axis}`, margin + 5, chartYPos + 90);
          
          chartIndex++;
          
          if (chartIndex % 2 === 0 || chartIndex === bearingsData.length * 3) {
            drawPageFooter(pdf, pageNum, pageWidth, pageHeight, margin);
            pageNum++;
          }
        });
      });
    } else {
      // No FFT data available - add a page with message
      pdf.addPage();
      drawPageHeader(pdf, logo, machine.machineName || machine.name, pageWidth, margin);
      
      pdf.setFontSize(14);
      pdf.setTextColor(150, 150, 150);
      pdf.text('No FFT Data Available', pageWidth / 2, 100, { align: 'center' });
      pdf.setFontSize(10);
      pdf.text('Real-time FFT data could not be retrieved from the API.', pageWidth / 2, 115, { align: 'center' });
      
      drawPageFooter(pdf, pageNum, pageWidth, pageHeight, margin);
      pageNum++;
    }
    
    return pageNum;
  };

  // Generate individual reports (one PDF per machine, all open in new tabs)
  const generateIndividualReports = async () => {
    if (!machines || machines.length === 0) return;
    
    setLoading(true);
    
    try {
      const logo = await loadLogo();
      const pdfBlobs = [];
      
      // Generate all PDFs first
      for (const machine of machines) {
        const pdf = new jsPDF('p', 'mm', 'a4');
        await generateMachineReport(pdf, machine, logo, 1);
        
        const pdfBlob = pdf.output('blob');
        const fileName = `Report_${(machine.machineName || machine.machineId || 'Machine').replace(/[^a-zA-Z0-9()-]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
        pdfBlobs.push({ blob: pdfBlob, name: fileName });
      }
      
      // Open all PDFs in new tabs simultaneously
      pdfBlobs.forEach(({ blob, name }) => {
        const pdfUrl = URL.createObjectURL(blob);
        const newTab = window.open(pdfUrl, '_blank');
        
        if (newTab) {
          newTab.document.title = name;
          setTimeout(() => {
            const link = newTab.document.createElement('a');
            link.href = pdfUrl;
            link.download = name;
            newTab.document.body.appendChild(link);
            link.click();
          }, 500);
        } else {
          // Fallback if popup blocked
          const link = document.createElement('a');
          link.href = pdfUrl;
          link.download = name;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      });
      
    } catch (error) {
      console.error('Report generation failed:', error);
      alert('Failed to generate reports. Please try again.');
    } finally {
      setLoading(false);
      setShowOptions(false);
    }
  };

  // Generate combined report (all machines in one PDF)
  const generateCombinedReport = async () => {
    if (!machines || machines.length === 0) return;
    
    setLoading(true);
    
    try {
      const logo = await loadLogo();
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      
      // Cover Page
      pdf.setFillColor(30, 41, 59);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      
      // Logo
      if (logo) {
        try {
          pdf.addImage(logo, 'JPEG', pageWidth / 2 - 30, 30, 60, 45);
        } catch (e) {}
      }
      
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(24);
      pdf.setFont('helvetica', 'bold');
      pdf.text('MULTI-MACHINE', pageWidth / 2, 100, { align: 'center' });
      pdf.text('VIBRATION ANALYSIS', pageWidth / 2, 115, { align: 'center' });
      pdf.text('REPORT', pageWidth / 2, 130, { align: 'center' });
      
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, 160, { align: 'center' });
      pdf.text(`Total Machines: ${machines.length}`, pageWidth / 2, 175, { align: 'center' });
      
      // List machines
      pdf.setFontSize(10);
      let listY = 200;
      machines.forEach((machine, idx) => {
        if (listY < pageHeight - 30) {
          pdf.text(`${idx + 1}. ${machine.machineName || machine.machineId}`, pageWidth / 2, listY, { align: 'center' });
          listY += 10;
        }
      });
      
      pdf.setFontSize(8);
      pdf.text('AAMS - Automated Asset Monitoring System', pageWidth / 2, pageHeight - 20, { align: 'center' });
      pdf.text('http://app.aams.io', pageWidth / 2, pageHeight - 12, { align: 'center' });
      
      // Generate pages for each machine
      let pageNum = 1;
      for (const machine of machines) {
        pdf.addPage();
        pageNum = await generateMachineReport(pdf, machine, logo, pageNum);
      }
      
      // Open in new tab and download
      const fileName = `Combined_Report_${machines.length}_Machines_${new Date().toISOString().split('T')[0]}.pdf`;
      const pdfBlob = pdf.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      
      const newTab = window.open(pdfUrl, '_blank');
      if (newTab) {
        newTab.document.title = fileName;
        setTimeout(() => {
          const link = newTab.document.createElement('a');
          link.href = pdfUrl;
          link.download = fileName;
          newTab.document.body.appendChild(link);
          link.click();
        }, 500);
      } else {
        const link = document.createElement('a');
        link.href = pdfUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      
    } catch (error) {
      console.error('Combined report generation failed:', error);
      alert('Failed to generate combined report. Please try again.');
    } finally {
      setLoading(false);
      setShowOptions(false);
    }
  };

  if (!machines || machines.length === 0) {
    return null;
  }

  return (
    <div className="multi-report-generator">
      <button
        onClick={() => setShowOptions(!showOptions)}
        disabled={loading}
        className="btn btn-primary"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
      >
        {loading ? (
          <>
            <Loader2 size={16} className="spinning" />
            Generating...
          </>
        ) : (
          <>
            <Download size={16} />
            Download Reports ({machines.length})
          </>
        )}
      </button>
      
      {showOptions && !loading && (
        <div className="report-options-dropdown" style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '4px',
          backgroundColor: 'white',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 100,
          minWidth: '220px'
        }}>
          <button
            onClick={generateIndividualReports}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              width: '100%',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              borderBottom: '1px solid #e2e8f0'
            }}
          >
            <FileText size={16} />
            <div>
              <div style={{ fontWeight: 500 }}>Individual Reports</div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                {machines.length} separate PDFs
              </div>
            </div>
          </button>
          <button
            onClick={generateCombinedReport}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              width: '100%',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            <FileText size={16} />
            <div>
              <div style={{ fontWeight: 500 }}>Combined Report</div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                All machines in 1 PDF
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
};

export default MultiReportGenerator;
