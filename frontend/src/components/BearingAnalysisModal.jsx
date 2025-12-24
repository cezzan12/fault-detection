import { useState, useEffect, useRef } from 'react';
import { X, Loader2, BarChart3, Activity, AlertTriangle, CheckCircle, AlertOctagon, Info, Zap, Settings } from 'lucide-react';
import { fetchBearingFFTAnalysis } from '../services/api';
import './BearingAnalysisModal.css';

const BearingAnalysisModal = ({ bearing, machine, onClose }) => {
    const canvasRef = useRef(null);
    const chartParamsRef = useRef(null); // Store chart parameters for mouse interaction
    const [selectedAxis, setSelectedAxis] = useState('V-Axis');
    const [analysisData, setAnalysisData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [hoverData, setHoverData] = useState(null); // Track mouse hover position and data

    // Fetch analysis data on mount
    useEffect(() => {
        const fetchAnalysis = async () => {
            setLoading(true);
            setError(null);

            try {
                const machineId = machine?.machineId || machine?._id;
                const bearingId = bearing?._id || bearing?.bearingId;

                if (!machineId || !bearingId) {
                    throw new Error('Machine ID or Bearing ID not available');
                }

                // Determine data type - check bearing type first, then machine type
                const dataType = bearing?.bearingLocationType ||
                    bearing?.type ||
                    machine?.type ||
                    machine?.bearingLocationType ||
                    'OFFLINE';

                console.log(`[FFT Analysis] Using data_type: ${dataType} for bearing ${bearingId}`);

                const response = await fetchBearingFFTAnalysis(machineId, bearingId, {
                    data_type: dataType
                });

                if (response.success) {
                    setAnalysisData(response);
                } else {
                    throw new Error(response.message || 'Analysis failed');
                }
            } catch (err) {
                console.error('FFT analysis failed:', err);
                setError(err.message || 'Failed to fetch analysis data');
            } finally {
                setLoading(false);
            }
        };

        fetchAnalysis();
    }, [bearing, machine]);

    // Draw FFT chart when data changes
    useEffect(() => {
        if (!loading && analysisData && canvasRef.current) {
            drawFFTChart();
        }
    }, [analysisData, loading, selectedAxis]);

    const drawFFTChart = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const padding = { top: 50, right: 50, bottom: 60, left: 70 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Get axis data
        const axisData = analysisData?.axisData?.[selectedAxis];

        if (!axisData?.available || !axisData?.fftSpectrum?.length) {
            // Draw "No Data Available" message
            ctx.fillStyle = '#64748b';
            ctx.font = 'bold 16px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No FFT Data Available', width / 2, height / 2 - 10);
            ctx.font = '12px Inter, system-ui, sans-serif';
            ctx.fillText(axisData?.error || 'Data not available for this axis', width / 2, height / 2 + 15);
            return;
        }

        const spectrum = axisData.fftSpectrum;
        const runningFreq = analysisData.runningFrequency || 25;
        const harmonics = axisData.harmonics || [];

        // Calculate max values
        const maxFreq = Math.max(...spectrum.map(d => d.frequency), runningFreq * 12);
        // Use tighter amplitude scaling for better peak visibility
        // Find the actual max amplitude from data and add only 5% headroom
        const actualMaxAmp = Math.max(...spectrum.map(d => d.amplitude));
        const maxAmplitude = actualMaxAmp > 0 ? actualMaxAmp * 1.05 : 0.1;

        // Store chart parameters for mouse interaction
        chartParamsRef.current = {
            padding,
            chartWidth,
            chartHeight,
            maxFreq,
            maxAmplitude,
            spectrum
        };

        // Background
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(padding.left, padding.top, chartWidth, chartHeight);

        // Draw running frequency band (±5%)
        const rfLower = runningFreq * 0.95;
        const rfUpper = runningFreq * 1.05;
        const rfX1 = padding.left + (rfLower / maxFreq) * chartWidth;
        const rfX2 = padding.left + (rfUpper / maxFreq) * chartWidth;
        ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
        ctx.fillRect(rfX1, padding.top, rfX2 - rfX1, chartHeight);

        // Draw harmonic markers
        harmonics.forEach((h, idx) => {
            if (h.harmonic > 1 && h.isSignificant) {
                const hX = padding.left + (h.detectedFrequency / maxFreq) * chartWidth;
                ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(hX, padding.top);
                ctx.lineTo(hX, padding.top + chartHeight);
                ctx.stroke();
                ctx.setLineDash([]);

                // Label
                ctx.fillStyle = '#f59e0b';
                ctx.font = '10px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`${h.harmonic}×`, hX, padding.top - 5);
            }
        });

        // Grid lines
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;

        // Horizontal grid
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (chartHeight / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();

            // Y-axis labels
            const ampValue = maxAmplitude * (1 - i / 5);
            ctx.fillStyle = '#64748b';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(ampValue.toFixed(2), padding.left - 8, y + 4);
        }

        // Vertical grid
        for (let i = 0; i <= 10; i++) {
            const x = padding.left + (chartWidth / 10) * i;
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + chartHeight);
            ctx.stroke();

            // X-axis labels
            const freq = (i / 10) * maxFreq;
            ctx.fillStyle = '#64748b';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(freq.toFixed(0), x, padding.top + chartHeight + 18);
        }

        // Chart border
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.strokeRect(padding.left, padding.top, chartWidth, chartHeight);

        // Draw FFT spectrum
        const colors = {
            'H-Axis': '#3b82f6',
            'V-Axis': '#10b981',
            'A-Axis': '#f59e0b'
        };

        ctx.strokeStyle = colors[selectedAxis] || '#6366f1';
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        spectrum.forEach((point, i) => {
            const x = padding.left + (point.frequency / maxFreq) * chartWidth;
            const y = padding.top + chartHeight - (point.amplitude / maxAmplitude) * chartHeight;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

        // Fill area under curve
        ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        ctx.lineTo(padding.left, padding.top + chartHeight);
        ctx.closePath();
        ctx.fillStyle = `${colors[selectedAxis] || '#6366f1'}15`;
        ctx.fill();

        // Mark 1× peak
        const peak1x = axisData.peakAt1x;
        if (peak1x) {
            const peakX = padding.left + (peak1x.frequency / maxFreq) * chartWidth;
            const peakY = padding.top + chartHeight - (peak1x.amplitude / maxAmplitude) * chartHeight;

            // Draw peak marker
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(peakX, peakY, 5, 0, Math.PI * 2);
            ctx.fill();

            // Peak label
            ctx.fillStyle = '#1e293b';
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`1× Peak: ${peak1x.frequency.toFixed(1)} Hz, ${peak1x.amplitude.toFixed(3)} mm/s`, peakX + 10, peakY - 5);
        }

        // Axis labels
        ctx.fillStyle = '#475569';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Frequency (Hz)', padding.left + chartWidth / 2, height - 10);

        ctx.save();
        ctx.translate(18, padding.top + chartHeight / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('Velocity (mm/s)', 0, 0);
        ctx.restore();

        // Title
        ctx.font = 'bold 14px Inter, sans-serif';
        ctx.fillStyle = '#1e293b';
        ctx.textAlign = 'center';
        ctx.fillText(`FFT Spectrum Analysis - ${selectedAxis}`, width / 2, 22);

        // Draw crosshair if hovering
        if (hoverData && hoverData.isInChart) {
            const { x, y, frequency, amplitude } = hoverData;

            // Vertical crosshair line
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.7)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + chartHeight);
            ctx.stroke();

            // Horizontal crosshair line
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Crosshair point
            ctx.fillStyle = '#6366f1';
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();

            // Tooltip background
            const tooltipX = x + 15;
            const tooltipY = Math.max(padding.top + 10, Math.min(y - 30, height - 60));
            const tooltipWidth = 160;
            const tooltipHeight = 50;

            // Make sure tooltip stays within chart
            const adjustedX = tooltipX + tooltipWidth > width ? x - tooltipWidth - 15 : tooltipX;

            ctx.fillStyle = 'rgba(30, 41, 59, 0.95)';
            ctx.beginPath();
            ctx.roundRect(adjustedX, tooltipY, tooltipWidth, tooltipHeight, 6);
            ctx.fill();

            // Tooltip text
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`Frequency: ${frequency.toFixed(2)} Hz`, adjustedX + 10, tooltipY + 20);
            ctx.fillText(`Amplitude: ${amplitude.toFixed(4)} mm/s`, adjustedX + 10, tooltipY + 38);
        }
    };

    // Handle mouse move on canvas
    const handleCanvasMouseMove = (e) => {
        if (!chartParamsRef.current) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        const { padding, chartWidth, chartHeight, maxFreq, maxAmplitude, spectrum } = chartParamsRef.current;

        // Check if mouse is within chart area
        const isInChart = x >= padding.left && x <= padding.left + chartWidth &&
            y >= padding.top && y <= padding.top + chartHeight;

        if (isInChart) {
            // Calculate frequency and amplitude from mouse position
            const frequency = ((x - padding.left) / chartWidth) * maxFreq;
            const amplitude = ((padding.top + chartHeight - y) / chartHeight) * maxAmplitude;

            // Find closest spectrum point for more accurate amplitude
            const closestPoint = spectrum.reduce((closest, point) => {
                return Math.abs(point.frequency - frequency) < Math.abs(closest.frequency - frequency) ? point : closest;
            }, spectrum[0]);

            setHoverData({
                x,
                y: padding.top + chartHeight - (closestPoint.amplitude / maxAmplitude) * chartHeight,
                frequency,
                amplitude: closestPoint.amplitude,
                isInChart: true
            });
        } else {
            setHoverData(null);
        }
    };

    // Handle mouse leave canvas
    const handleCanvasMouseLeave = () => {
        setHoverData(null);
    };

    // Redraw chart when hover data changes
    useEffect(() => {
        if (!loading && analysisData && canvasRef.current) {
            drawFFTChart();
        }
    }, [hoverData]);

    const bearingId = bearing?._id || bearing?.bearingId || 'Unknown';
    const machineName = machine?.name || machine?.machineName || 'Unknown Machine';

    // Get EXTERNAL bearing status - prefer from API response, fallback to bearing prop
    const externalStatus = analysisData?.externalStatus || bearing?.statusName || bearing?.status || 'Unknown';

    // Map external status to display config
    const getExternalStatusDisplay = (status) => {
        const statusLower = (status || '').toLowerCase();
        const displays = {
            'normal': { icon: CheckCircle, color: '#10b981', label: 'Normal' },
            'satisfactory': { icon: Activity, color: '#06b6d4', label: 'Satisfactory' },
            'alert': { icon: AlertTriangle, color: '#f59e0b', label: 'Alert' },
            'unacceptable': { icon: AlertOctagon, color: '#ef4444', label: 'Unacceptable' },
            'unsatisfactory': { icon: AlertOctagon, color: '#ef4444', label: 'Unacceptable' }
        };
        return displays[statusLower] || { icon: Info, color: '#64748b', label: status || 'Unknown' };
    };

    const externalStatusDisplay = getExternalStatusDisplay(externalStatus);
    const ExternalStatusIcon = externalStatusDisplay.icon;

    // Get severity icon and color for our FFT-based calculation
    const getSeverityDisplay = (severity) => {
        if (!severity) return { icon: Info, color: '#64748b', label: 'N/A' };

        const displays = {
            'A': { icon: CheckCircle, color: '#10b981', label: 'Normal' },
            'B': { icon: Activity, color: '#06b6d4', label: 'Satisfactory' },
            'C': { icon: AlertTriangle, color: '#f59e0b', label: 'Alert' },
            'D': { icon: AlertOctagon, color: '#ef4444', label: 'Unacceptable' }
        };
        return displays[severity.zone] || displays['A'];
    };

    const severity = analysisData?.overallSeverity;
    const diagnosis = analysisData?.overallDiagnosis;
    const severityDisplay = getSeverityDisplay(severity);
    const SeverityIcon = severityDisplay.icon;

    // Export FFT data to CSV for verification
    const exportToCSV = () => {
        if (!analysisData) return;

        const axisData = analysisData?.axisData?.[selectedAxis];
        if (!axisData?.available || !axisData?.fftSpectrum?.length) {
            alert('No FFT data available for the selected axis');
            return;
        }

        const spectrum = axisData.fftSpectrum;
        const harmonics = axisData.harmonics || [];

        // Build CSV content
        let csvContent = '';

        // Header with analysis parameters
        csvContent += 'FFT Analysis Export\n';
        csvContent += `Machine ID,${analysisData.machineId}\n`;
        csvContent += `Bearing ID,${analysisData.bearingId}\n`;
        csvContent += `Axis,${selectedAxis}\n`;
        csvContent += `RPM,${analysisData.rpm || 'N/A'}\n`;
        csvContent += `Running Frequency (Hz),${analysisData.runningFrequency || 'N/A'}\n`;
        csvContent += `Sample Rate (Hz),${analysisData.sampleRate || 'N/A'}\n`;
        csvContent += `External Status,${externalStatus}\n`;
        csvContent += `ISO Severity Zone,${severity?.zone || 'N/A'}\n`;
        csvContent += `Velocity RMS (mm/s),${severity?.velocityRMS?.toFixed(6) || 'N/A'}\n`;
        csvContent += `Export Time,${new Date().toISOString()}\n`;
        csvContent += '\n';

        // Harmonics section
        csvContent += 'DETECTED HARMONICS\n';
        csvContent += 'Harmonic,Expected Freq (Hz),Detected Freq (Hz),Amplitude (mm/s),Significant\n';
        harmonics.forEach(h => {
            csvContent += `${h.label},${h.expectedFrequency?.toFixed(2)},${h.detectedFrequency?.toFixed(2)},${h.amplitude?.toFixed(6)},${h.isSignificant ? 'Yes' : 'No'}\n`;
        });
        csvContent += '\n';

        // FFT Spectrum data
        csvContent += 'FFT SPECTRUM DATA\n';
        csvContent += 'Frequency (Hz),Amplitude (mm/s)\n';
        spectrum.forEach(point => {
            csvContent += `${point.frequency.toFixed(4)},${point.amplitude.toFixed(8)}\n`;
        });

        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `FFT_${analysisData.machineId?.slice(-8)}_${selectedAxis}_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="analysis-modal-overlay" onClick={onClose}>
            <div className="analysis-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="analysis-modal-header">
                    <div className="analysis-modal-title">
                        <BarChart3 size={24} />
                        <div>
                            <h2>Bearing Condition Analysis</h2>
                            <p>{machineName} - Bearing: {bearingId}</p>
                        </div>
                    </div>
                    <button className="analysis-close-btn" onClick={onClose}>
                        <X size={24} />
                    </button>
                </div>

                <div className="analysis-modal-body">
                    {loading ? (
                        <div className="analysis-loading">
                            <Loader2 size={48} className="spinning" />
                            <p>Performing FFT analysis on all axes...</p>
                            <small>This may take a moment</small>
                        </div>
                    ) : error ? (
                        <div className="analysis-error">
                            <AlertTriangle size={48} />
                            <h3>Analysis Failed</h3>
                            <p>{error}</p>
                        </div>
                    ) : (
                        <>
                            {/* Machine Info Bar */}
                            <div className="analysis-info-bar">
                                <div className="info-item">
                                    <Settings size={16} />
                                    <span className="info-label">RPM:</span>
                                    <span className="info-value">{analysisData?.rpm || 'N/A'}</span>
                                </div>
                                <div className="info-item">
                                    <Zap size={16} />
                                    <span className="info-label">Running Freq:</span>
                                    <span className="info-value">{analysisData?.runningFrequency ? `${analysisData.runningFrequency} Hz` : 'N/A'}</span>
                                </div>
                                <div className="info-item">
                                    <Activity size={16} />
                                    <span className="info-label">Sample Rate:</span>
                                    <span className="info-value">{analysisData?.sampleRate ? `${analysisData.sampleRate} Hz` : 'N/A'}</span>
                                </div>
                            </div>

                            {/* Axis Selector */}
                            <div className="axis-selector">
                                {['H-Axis', 'V-Axis', 'A-Axis'].map((axis) => {
                                    const axisData = analysisData?.axisData?.[axis];
                                    const isAvailable = axisData?.available;
                                    return (
                                        <button
                                            key={axis}
                                            className={`axis-btn ${selectedAxis === axis ? 'active' : ''} ${!isAvailable ? 'disabled' : ''}`}
                                            onClick={() => isAvailable && setSelectedAxis(axis)}
                                            disabled={!isAvailable}
                                        >
                                            {axis.replace('-Axis', '')}
                                            {!isAvailable && <span className="axis-error">N/A</span>}
                                        </button>
                                    );
                                })}
                                <button
                                    className="export-btn"
                                    onClick={exportToCSV}
                                    title="Export FFT data to CSV for verification"
                                >
                                    📥 Export CSV
                                </button>
                            </div>

                            {/* FFT Chart */}
                            <div className="analysis-chart-area">
                                <canvas
                                    ref={canvasRef}
                                    width={900}
                                    height={400}
                                    className="analysis-canvas"
                                    onMouseMove={handleCanvasMouseMove}
                                    onMouseLeave={handleCanvasMouseLeave}
                                    style={{ cursor: 'crosshair' }}
                                />
                            </div>

                            {/* Analysis Results Grid */}
                            <div className="analysis-results-grid">
                                {/* External Status Panel (PRIMARY - from AAMS API) */}
                                <div className="result-panel severity-panel" style={{ borderColor: externalStatusDisplay.color }}>
                                    <h4>AAMS Status</h4>
                                    <div className="severity-display" style={{ color: externalStatusDisplay.color }}>
                                        <ExternalStatusIcon size={32} />
                                        <div className="severity-info">
                                            <span className="severity-zone">{externalStatusDisplay.label}</span>
                                            <span className="severity-label">From External API</span>
                                        </div>
                                    </div>
                                    <div className="severity-comparison">
                                        <small style={{ color: '#64748b' }}>
                                            FFT Analysis: Zone {severity?.zone || 'N/A'} ({severity?.velocityRMS?.toFixed(3) || 'N/A'} mm/s RMS)
                                        </small>
                                    </div>
                                </div>

                                {/* Harmonics Panel */}
                                <div className="result-panel harmonics-panel">
                                    <h4>Harmonic Analysis</h4>
                                    <div className="harmonic-count">
                                        <span className="count-number">{diagnosis?.harmonicCount || 0}</span>
                                        <span className="count-label">Significant Harmonics</span>
                                    </div>
                                    <div className="harmonics-list">
                                        {analysisData?.axisData?.[selectedAxis]?.harmonics?.slice(0, 5).map((h, idx) => (
                                            <div key={idx} className={`harmonic-item ${h.isSignificant ? 'significant' : ''}`}>
                                                <span className="harmonic-label">{h.label}</span>
                                                <span className="harmonic-freq">{h.detectedFrequency?.toFixed(1)} Hz</span>
                                                <span className="harmonic-amp">{h.amplitude?.toFixed(3)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Diagnosis Panel */}
                                <div className="result-panel diagnosis-panel">
                                    <h4>Fault Diagnosis</h4>
                                    <div className="diagnosis-header">
                                        <span className="fault-type">{diagnosis?.faultType || 'Unknown'}</span>
                                        <span className={`confidence-badge ${diagnosis?.confidence?.toLowerCase()}`}>
                                            {diagnosis?.confidence || 'N/A'} Confidence
                                        </span>
                                    </div>
                                    <div className="diagnosis-evidence">
                                        <strong>Evidence:</strong>
                                        <ul>
                                            {diagnosis?.evidence?.map((e, idx) => (
                                                <li key={idx}>{e}</li>
                                            ))}
                                        </ul>
                                    </div>
                                    <div className="diagnosis-action" style={{ backgroundColor: diagnosis?.actionColor + '20', borderColor: diagnosis?.actionColor }}>
                                        <strong>Recommendation:</strong> {diagnosis?.action || diagnosis?.recommendation || 'Monitor'}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BearingAnalysisModal;
