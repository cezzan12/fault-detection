import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Cpu,
  Users,
  MapPin,
  Clock,
  Wifi,
  WifiOff,
  Target,
  FileText,
  BarChart3,
  Loader2,
  Copy,
  Check,
  AlertTriangle,
  Layers,
  Activity
} from 'lucide-react';
import { fetchMachineById, fetchMachineBearingData } from '../services/api';
import BearingReportGenerator from './BearingReportGenerator';
import FFTChartModal from './FFTChartModal';
import BearingAnalysisModal from './BearingAnalysisModal';
import './MachineDetail.css';

const StatusBadge = ({ status }) => {
  const statusConfig = {
    normal: { label: 'Normal', className: 'badge-normal' },
    satisfactory: { label: 'Satisfactory', className: 'badge-satisfactory' },
    alert: { label: 'Alert', className: 'badge-alert' },
    unacceptable: { label: 'Unacceptable', className: 'badge-unacceptable' },
    unsatisfactory: { label: 'Unacceptable', className: 'badge-unacceptable' }
  };

  const normalizedStatus = (status || 'normal').toLowerCase();
  const config = statusConfig[normalizedStatus] || statusConfig.normal;

  return (
    <span className={`status - badge ${config.className} `}>
      {config.label}
    </span>
  );
};

const CopyableId = ({ value, label }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="copyable-id">
      <span className="id-value">{value}</span>
      <button className="copy-btn" onClick={handleCopy} title={`Copy ${label} `}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
};

const MachineDetail = ({ machineId, machineInfo, onBack }) => {
  const [machine, setMachine] = useState(null);
  const [bearings, setBearings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedBearing, setSelectedBearing] = useState(null);
  const [showFFTModal, setShowFFTModal] = useState(false);
  const [fftData, setFftData] = useState(null);
  const [loadingFFT, setLoadingFFT] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analyzeBearing, setAnalyzeBearing] = useState(null);

  useEffect(() => {
    const loadMachineDetails = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchMachineById(machineId);
        const machineData = response.machine;

        // Merge API data with machineInfo passed from table (which has the name)
        const mergedData = {
          ...machineData,
          // Prefer machineInfo values for display fields (from the table data)
          name: machineInfo?.machineName || machineData.name || machineData.machineName,
          machineName: machineInfo?.machineName || machineData.name || machineData.machineName,
          customerId: machineInfo?.customerId || machineData.customerId,
          areaId: machineInfo?.areaId || machineData.areaId,
          type: machineInfo?.type || machineData.type || machineData.bearingLocationType,
          status: machineInfo?.status || machineData.statusName || machineData.status,
          dataUpdatedTime: machineInfo?.date || machineData.dataUpdatedTime,
          subareaId: machineInfo?.subareaId || machineData.subAreaId
        };

        setMachine(mergedData);
        setBearings(machineData.bearings || []);
      } catch (err) {
        console.error('Failed to fetch machine details:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (machineId) {
      loadMachineDetails();
    }
  }, [machineId, machineInfo]);

  const handleShowCharts = async (bearing) => {
    setSelectedBearing(bearing);
    setLoadingFFT(true);
    setShowFFTModal(true);

    try {
      // Fetch FFT data for the bearing
      const bearingId = bearing._id || bearing.bearingId;
      const response = await fetchMachineBearingData(machineId, bearingId, {
        date: new Date().toISOString().split('T')[0],
        axis: 'V-Axis',
        data_type: machine?.type || 'OFFLINE',
        analytics_type: 'MF'
      });
      setFftData(response);
    } catch (err) {
      console.error('Failed to fetch FFT data:', err);
      // Use mock data if API fails
      setFftData(generateMockFFTData());
    } finally {
      setLoadingFFT(false);
    }
  };

  const generateMockFFTData = () => {
    // Return empty FFT data when API fails - no random data
    return { fftData: [], axis: 'V-Axis', message: 'No data available' };
  };

  const formatDate = (dateStr) => {
    if (!dateStr || dateStr === 'N/A') return 'N/A';
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <div className="machine-detail-container">
        <div className="detail-loading">
          <Loader2 size={40} className="spinning" />
          <p>Loading machine details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="machine-detail-container">
        <div className="detail-error">
          <AlertTriangle size={40} />
          <p>Failed to load machine: {error}</p>
          <button onClick={onBack} className="btn btn-secondary">
            <ArrowLeft size={16} /> Go Back
          </button>
        </div>
      </div>
    );
  }

  if (!machine) {
    return (
      <div className="machine-detail-container">
        <div className="detail-error">
          <p>Machine not found</p>
          <button onClick={onBack} className="btn btn-secondary">
            <ArrowLeft size={16} /> Go Back
          </button>
        </div>
      </div>
    );
  }

  const machineName = machine.name || machine.machineName || 'Unknown Machine';
  const status = (machine.statusName || machine.status || 'normal').toLowerCase();
  const type = machine.type || 'OFFLINE';

  return (
    <div className="machine-detail-container">
      {/* Back Button and Header */}
      <div className="detail-header-bar">
        <button onClick={onBack} className="back-button">
          <ArrowLeft size={20} />
          Back to Machines
        </button>
      </div>

      {/* Machine Info Card */}
      <div className="machine-info-card">
        <div className="machine-title-row">
          <div className="machine-icon">
            <Cpu size={24} />
          </div>
          <h1 className="machine-name">{machineName.toUpperCase()}</h1>
        </div>
        <p className="machine-subtitle">Detailed machine information and bearing data</p>

        <BearingReportGenerator machine={machine} bearings={bearings} />

        {/* Info Grid */}
        <div className="info-grid">
          <div className="info-card">
            <div className="info-icon">
              <Cpu size={20} />
            </div>
            <div className="info-content">
              <span className="info-label">MACHINE ID</span>
              <CopyableId value={machine.machineId || machine._id || 'N/A'} label="Machine ID" />
            </div>
          </div>

          <div className="info-card">
            <div className="info-icon">
              <Users size={20} />
            </div>
            <div className="info-content">
              <span className="info-label">CUSTOMER ID</span>
              <CopyableId value={machine.customerId || 'N/A'} label="Customer ID" />
            </div>
          </div>

          <div className="info-card">
            <div className="info-content status-card">
              <span className="info-label">STATUS</span>
              <StatusBadge status={status} />
            </div>
          </div>

          <div className="info-card">
            <div className="info-icon">
              <MapPin size={20} />
            </div>
            <div className="info-content">
              <span className="info-label">AREA ID</span>
              <CopyableId value={machine.areaId || 'N/A'} label="Area ID" />
            </div>
          </div>

          <div className="info-card">
            <div className="info-icon">
              <Layers size={20} />
            </div>
            <div className="info-content">
              <span className="info-label">SUBAREA ID</span>
              <CopyableId value={machine.subareaId || machine.subAreaId || 'N/A'} label="Subarea ID" />
            </div>
          </div>

          <div className="info-card">
            <div className="info-icon">
              <Target size={20} />
            </div>
            <div className="info-content">
              <span className="info-label">TYPE</span>
              <span className={`type - value ${type === 'ONLINE' ? 'online' : 'offline'} `}>
                {type === 'ONLINE' ? <Wifi size={14} /> : <WifiOff size={14} />}
                {type}
              </span>
            </div>
          </div>

          <div className="info-card">
            <div className="info-icon">
              <Clock size={20} />
            </div>
            <div className="info-content">
              <span className="info-label">LAST UPDATED</span>
              <span className="info-value">{formatDate(machine.dataUpdatedTime)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bearings Section */}
      <div className="bearings-section">
        <div className="section-header">
          <Target size={20} />
          <h2>Bearings</h2>
        </div>

        <div className="bearings-table-wrapper">
          <table className="bearings-table">
            <thead>
              <tr>
                <th>BEARING ID</th>
                <th>STATUS</th>
                <th>FFT</th>
              </tr>
            </thead>
            <tbody>
              {bearings.length > 0 ? (
                bearings.map((bearing, index) => {
                  const bearingId = bearing._id || bearing.bearingId || `bearing - ${index} `;
                  const bearingStatus = (bearing.statusName || bearing.status || 'satisfactory').toLowerCase();

                  return (
                    <tr key={bearingId}>
                      <td className="bearing-id-cell">{bearingId}</td>
                      <td>
                        <StatusBadge status={bearingStatus} />
                      </td>
                      <td className="actions-cell">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleShowCharts(bearing)}
                        >
                          <BarChart3 size={14} />
                          Show Charts
                        </button>
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => {
                            setAnalyzeBearing(bearing);
                            setShowAnalysisModal(true);
                          }}
                        >
                          <Activity size={14} />
                          Analyze
                        </button>
                        <BearingReportGenerator
                          machine={machine}
                          bearing={bearing}
                          bearings={[bearing]}
                          isSingleBearing={true}
                        />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="3" className="empty-bearings">
                    No bearings found for this machine
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* FFT Chart Modal */}
      {showFFTModal && (
        <FFTChartModal
          bearing={selectedBearing}
          machine={machine}
          fftData={fftData}
          loading={loadingFFT}
          onClose={() => {
            setShowFFTModal(false);
            setSelectedBearing(null);
            setFftData(null);
          }}
        />
      )}

      {/* Bearing Analysis Modal */}
      {showAnalysisModal && analyzeBearing && (
        <BearingAnalysisModal
          bearing={analyzeBearing}
          machine={machine}
          onClose={() => {
            setShowAnalysisModal(false);
            setAnalyzeBearing(null);
          }}
        />
      )}
    </div>
  );
};

export default MachineDetail;
