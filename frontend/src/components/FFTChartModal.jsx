import { useState, useEffect, useRef } from 'react';
import { X, Loader2, BarChart3 } from 'lucide-react';
import './FFTChartModal.css';

const FFTChartModal = ({ bearing, machine, fftData, loading, onClose }) => {
  const canvasRef = useRef(null);
  const [selectedAxis, setSelectedAxis] = useState('V-Axis');

  useEffect(() => {
    if (!loading && fftData && canvasRef.current) {
      drawFFTChart();
    }
  }, [fftData, loading, selectedAxis]);

  const drawFFTChart = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = { top: 40, right: 40, bottom: 50, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Get FFT data
    let data = [];
    if (fftData?.fftData) {
      data = Array.isArray(fftData.fftData) ? fftData.fftData : [];
    } else if (Array.isArray(fftData)) {
      data = fftData;
    }

    // If no real data available, show empty chart
    if (data.length === 0) {
      // Draw "No Data Available" message
      ctx.fillStyle = '#64748b';
      ctx.font = '14px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No FFT data available', padding.left + chartWidth / 2, padding.top + chartHeight / 2);
      return;
    }

    // Background
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(padding.left, padding.top, chartWidth, chartHeight);

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
    }

    // Vertical grid
    for (let i = 0; i <= 10; i++) {
      const x = padding.left + (chartWidth / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartHeight);
      ctx.stroke();
    }

    // Chart border
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.strokeRect(padding.left, padding.top, chartWidth, chartHeight);

    // Draw FFT data
    if (data.length > 0) {
      const maxFreq = Math.max(...data.map(d => d.frequency || 0), 1000);
      const maxAmplitude = Math.max(...data.map(d => d.amplitude || 0), 0.5);

      // Line color based on axis
      const colors = {
        'H-Axis': '#3b82f6',
        'V-Axis': '#10b981',
        'A-Axis': '#f59e0b'
      };
      ctx.strokeStyle = colors[selectedAxis] || '#6366f1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      data.forEach((point, i) => {
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
      ctx.fillStyle = `${colors[selectedAxis] || '#6366f1'}20`;
      ctx.fill();
    }

    // X-axis labels
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 10; i++) {
      const freq = (i / 10) * 1000;
      const x = padding.left + (chartWidth / 10) * i;
      ctx.fillText(freq.toFixed(0), x, padding.top + chartHeight + 20);
    }
    ctx.fillText('Frequency (Hz)', padding.left + chartWidth / 2, padding.top + chartHeight + 40);

    // Y-axis label
    ctx.save();
    ctx.translate(20, padding.top + chartHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Velocity (mm/s)', 0, 0);
    ctx.restore();

    // Title
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'center';
    ctx.fillText(`FFT Spectrum - ${selectedAxis}`, width / 2, 25);
  };

  const bearingId = bearing?._id || bearing?.bearingId || 'Unknown';
  const machineName = machine?.name || machine?.machineName || 'Unknown Machine';

  return (
    <div className="fft-modal-overlay" onClick={onClose}>
      <div className="fft-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="fft-modal-header">
          <div className="fft-modal-title">
            <BarChart3 size={24} />
            <div>
              <h2>FFT Analysis</h2>
              <p>{machineName} - Bearing: {bearingId}</p>
            </div>
          </div>
          <button className="fft-close-btn" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <div className="fft-modal-body">
          {/* Axis Selector */}
          <div className="axis-selector">
            {['H-Axis', 'V-Axis', 'A-Axis'].map((axis) => (
              <button
                key={axis}
                className={`axis-btn ${selectedAxis === axis ? 'active' : ''}`}
                onClick={() => setSelectedAxis(axis)}
              >
                {axis}
              </button>
            ))}
          </div>

          {/* Chart Area */}
          <div className="fft-chart-area">
            {loading ? (
              <div className="fft-loading">
                <Loader2 size={40} className="spinning" />
                <p>Loading FFT data...</p>
              </div>
            ) : (
              <canvas 
                ref={canvasRef} 
                width={800} 
                height={400}
                className="fft-canvas"
              />
            )}
          </div>

          {/* Legend */}
          <div className="fft-legend">
            <div className="legend-item">
              <span className="legend-color h-axis"></span>
              H-Axis (Horizontal)
            </div>
            <div className="legend-item">
              <span className="legend-color v-axis"></span>
              V-Axis (Vertical)
            </div>
            <div className="legend-item">
              <span className="legend-color a-axis"></span>
              A-Axis (Axial)
            </div>
          </div>

          {/* Info */}
          <div className="fft-info">
            <div className="info-item">
              <span className="info-label">Sample Rate:</span>
              <span className="info-value">20000 Hz</span>
            </div>
            <div className="info-item">
              <span className="info-label">Frequency Range:</span>
              <span className="info-value">0 - 1000 Hz</span>
            </div>
            <div className="info-item">
              <span className="info-label">Analysis Type:</span>
              <span className="info-value">Velocity Spectrum</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FFTChartModal;
