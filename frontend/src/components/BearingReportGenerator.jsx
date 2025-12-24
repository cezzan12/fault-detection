import React, { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { downloadReport } from '../services/api';

/**
 * BearingReportGenerator - Downloads PDF reports from the backend
 * 
 * Uses backend report generation with new FFT analysis logic:
 * - velocity_convert with Butterworth filtering
 * - Hanning window + overlapping block FFT
 * - ISO 10816-3 severity assessment
 */
const BearingReportGenerator = ({ machine, bearing, bearings = [], isSingleBearing = false }) => {
  const [loading, setLoading] = useState(false);

  const generatePDFReport = async () => {
    if (!machine) return;

    setLoading(true);

    try {
      const machineId = machine.machineId || machine._id;
      const bearingId = isSingleBearing && bearing ? (bearing._id || bearing.bearingId) : null;
      const machineName = machine.name || machine.machineName || 'Machine';
      const machineType = machine.type || 'OFFLINE';

      console.log('[BearingReportGenerator] Generating PDF via backend...', { machineId, bearingId });

      // Download PDF from backend (uses new FFT logic)
      const blob = await downloadReport(machineId, bearingId, {
        dataType: machineType,
        machineClass: 'II',
        includeCharts: true
      });

      // Create download link
      const url = URL.createObjectURL(blob);
      const bearingName = isSingleBearing && bearing ?
        (bearing._id || bearing.bearingId || 'bearing').substring(0, 20) :
        'all_bearings';

      // Clean filename
      const safeMachineName = machineName.replace(/[^a-zA-Z0-9()-]/g, '_').substring(0, 30);
      const fileName = `Report_${safeMachineName}_${bearingName}_${new Date().toISOString().split('T')[0]}.pdf`;

      // Trigger download
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Open in new tab as well
      window.open(url, '_blank');

      console.log('[BearingReportGenerator] PDF downloaded successfully');

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
