import React, { useState } from 'react';
import jsPDF from 'jspdf';
import { FileText, Loader2 } from 'lucide-react';

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

// Generate mock bearing data for demonstration
const generateMockBearingData = (machine) => {
  const bearings = ['Motor DE', 'Motor NDE', 'Pump DE', 'Pump NDE'];
  const date = machine.date || new Date().toISOString().split('T')[0];
  
  return bearings.map((bearingName, idx) => {
    // Generate realistic vibration values based on machine status
    const statusMultiplier = machine.status === 'unacceptable' ? 2.5 : 
                            machine.status === 'alert' ? 1.8 : 
                            machine.status === 'satisfactory' ? 1.2 : 1.0;
    
    const baseVel = (0.5 + Math.random() * 1.5) * statusMultiplier;
    const baseAcc = (0.1 + Math.random() * 0.3) * statusMultiplier;
    const baseEnv = (0.05 + Math.random() * 0.15) * statusMultiplier;
    
    return {
      bearingName,
      date,
      sr: 20000,
      metrics: {
        H: { 
          vel: (baseVel + Math.random() * 0.5).toFixed(2), 
          acc: (baseAcc + Math.random() * 0.1).toFixed(3), 
          env: (baseEnv + Math.random() * 0.05).toFixed(3) 
        },
        V: { 
          vel: (baseVel + Math.random() * 0.8).toFixed(2), 
          acc: (baseAcc + Math.random() * 0.15).toFixed(3), 
          env: (baseEnv + Math.random() * 0.08).toFixed(3) 
        },
        A: { 
          vel: (baseVel + Math.random() * 0.3).toFixed(2), 
          acc: (baseAcc + Math.random() * 0.08).toFixed(3), 
          env: (baseEnv + Math.random() * 0.03).toFixed(3) 
        }
      },
      // Generate FFT data points
      fftData: {
        H: generateFFTData(200, statusMultiplier),
        V: generateFFTData(200, statusMultiplier),
        A: generateFFTData(200, statusMultiplier)
      }
    };
  });
};

// Generate FFT-like frequency data
const generateFFTData = (numPoints, amplitudeMultiplier = 1) => {
  const data = [];
  for (let i = 0; i < numPoints; i++) {
    const freq = (i / numPoints) * 1000; // 0-1000 Hz
    // Create peaks at certain frequencies to simulate real FFT
    let amplitude = Math.random() * 0.02 * amplitudeMultiplier;
    
    // Add characteristic peaks
    if (Math.abs(freq - 50) < 5) amplitude += 0.3 * amplitudeMultiplier; // 1x RPM peak
    if (Math.abs(freq - 100) < 5) amplitude += 0.15 * amplitudeMultiplier; // 2x
    if (Math.abs(freq - 150) < 5) amplitude += 0.08 * amplitudeMultiplier; // 3x
    if (Math.abs(freq - 180) < 10) amplitude += 0.05 * amplitudeMultiplier; // bearing freq
    if (Math.abs(freq - 360) < 10) amplitude += 0.03 * amplitudeMultiplier; // 2x bearing
    
    data.push({ freq, amplitude });
  }
  return data;
};

const ReportGenerator = ({ machine, onGenerateStart, onGenerateEnd }) => {
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

  const generatePDFReport = async () => {
    if (!machine) return;
    
    setLoading(true);
    if (onGenerateStart) onGenerateStart();

    try {
      // Load logo
      const logo = await loadLogo();
      
      // Generate bearing data
      const bearingsData = generateMockBearingData(machine);
      
      // Create PDF (A4 size)
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const contentWidth = pageWidth - 2 * margin;
      const severity = getStatusSeverity(machine.status);
      
      let pageNum = 1;

      // ==================== PAGE 1: Severity Levels Reference ====================
      let yPos = 0;

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
        { code: 'C', level: 3, title: 'Severity level 3:', desc: "This level is considered 'Unsatisfactory', there has been an increase in the vibration and indicates problem in the machine. Maintenance action can be taken during equipment availability / Planned shutdown.", color: [245, 158, 11] },
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
        pdf.text(detail.value, x + 35, y);
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
      
      // Table data rows
      bearingsData.forEach((bearing, bIdx) => {
        ['H', 'V', 'A'].forEach((axis, aIdx) => {
          tableX = margin;
          const metrics = bearing.metrics[axis];
          const rowData = [
            aIdx === 0 ? bearing.bearingName : '',
            aIdx === 0 ? bearing.date : '',
            axis,
            metrics.vel,
            metrics.acc,
            metrics.env,
            '-'
          ];
          
          const bgColor = bIdx % 2 === 0 ? [255, 255, 255] : [248, 250, 252];
          
          colWidths.forEach((w, i) => {
            pdf.setFillColor(...bgColor);
            pdf.rect(tableX, yPos, w, rowHeight, 'F');
            pdf.setDrawColor(226, 232, 240);
            pdf.rect(tableX, yPos, w, rowHeight, 'S');
            
            // Color code velocity values
            if (i === 3) {
              const velColor = getVelocityColor(rowData[i]);
              pdf.setTextColor(...velColor);
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

      drawPageFooter(pdf, pageNum, pageWidth, pageHeight, margin);
      pageNum++;
      
      // ==================== PAGE 4+: FFT Charts ====================
      // Generate FFT chart pages (2 charts per page)
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
      
      // Open PDF in new tab and trigger download
      const fileName = `Report_${(machine.machineName || machine.machineId || 'Machine').replace(/[^a-zA-Z0-9()-]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
      
      // Get PDF as blob and create object URL
      const pdfBlob = pdf.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      
      // Open in new tab
      const newTab = window.open(pdfUrl, '_blank');
      
      // If popup was blocked, fall back to direct download
      if (!newTab || newTab.closed || typeof newTab.closed === 'undefined') {
        // Fallback: create download link
        const link = document.createElement('a');
        link.href = pdfUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        // Set the title of the new tab (for better UX)
        newTab.document.title = fileName;
        
        // Also trigger download in the new tab
        setTimeout(() => {
          const link = newTab.document.createElement('a');
          link.href = pdfUrl;
          link.download = fileName;
          newTab.document.body.appendChild(link);
          link.click();
        }, 500);
      }
      
    } catch (error) {
      console.error('Report generation failed:', error);
      alert('Failed to generate report. Please try again.');
    } finally {
      setLoading(false);
      if (onGenerateEnd) onGenerateEnd();
    }
  };

  return (
    <button
      onClick={generatePDFReport}
      disabled={loading || !machine}
      className="btn btn-primary"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        opacity: (!machine || loading) ? 0.6 : 1,
        cursor: (!machine || loading) ? 'not-allowed' : 'pointer'
      }}
    >
      {loading ? (
        <>
          <Loader2 size={16} className="spinning" />
          Generating...
        </>
      ) : (
        <>
          <FileText size={16} />
          Download Report
        </>
      )}
    </button>
  );
};

export default ReportGenerator;
