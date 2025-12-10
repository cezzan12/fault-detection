import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Eye, Wifi, WifiOff, Loader2, AlertTriangle, Database, FileText, Download } from 'lucide-react';
import './MachinesTable.css';

const ROWS_PER_PAGE = 10;

const StatusBadge = ({ status }) => {
  const statusConfig = {
    normal: { label: 'Normal', className: 'badge-normal' },
    satisfactory: { label: 'Satisfactory', className: 'badge-satisfactory' },
    alert: { label: 'Alert', className: 'badge-alert' },
    unacceptable: { label: 'Unacceptable', className: 'badge-unacceptable' }
  };

  const config = statusConfig[status] || statusConfig.normal;

  return (
    <span className={`status-badge ${config.className}`}>
      {config.label}
    </span>
  );
};

const TypeBadge = ({ type }) => {
  const isOnline = type === 'ONLINE';
  return (
    <span className={`type-badge ${isOnline ? 'type-online' : 'type-offline'}`}>
      {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
      {type}
    </span>
  );
};

const MachinesTable = ({ data = [], filters, loading = false, error = null }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [generatingReport, setGeneratingReport] = useState(false);

  // Filter data based on filters
  const filteredData = useMemo(() => {
    return data.filter(machine => {
      if (filters.areaId !== 'All' && machine.areaId !== filters.areaId) return false;
      if (filters.status !== 'All' && machine.status !== filters.status) return false;
      if (filters.customerId !== 'All' && machine.customerId !== filters.customerId) return false;
      if (filters.fromDate && machine.date < filters.fromDate) return false;
      if (filters.toDate && machine.date > filters.toDate) return false;
      return true;
    });
  }, [data, filters]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredData.length / ROWS_PER_PAGE);
  const startIndex = (currentPage - 1) * ROWS_PER_PAGE;
  const endIndex = startIndex + ROWS_PER_PAGE;
  const currentData = filteredData.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  useMemo(() => {
    setCurrentPage(1);
  }, [filters]);

  const handlePrevPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, totalPages));
  };

  const handleMachineSelect = (machine) => {
    setSelectedMachine(selectedMachine?.id === machine.id ? null : machine);
  };

  const generateReport = async () => {
    if (!selectedMachine) return;
    
    setGeneratingReport(true);
    
    // Simulate report generation delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Create report content
    const reportContent = `
================================================================================
                        MACHINE STATUS REPORT
================================================================================

Generated: ${new Date().toLocaleString()}

--------------------------------------------------------------------------------
                            MACHINE DETAILS
--------------------------------------------------------------------------------

Customer ID:      ${selectedMachine.customerId}
Machine Name:     ${selectedMachine.machineName}
Machine ID:       ${selectedMachine.machineId}
Status:           ${selectedMachine.status.toUpperCase()}
Type:             ${selectedMachine.type}
Area ID:          ${selectedMachine.areaId}
Subarea ID:       ${selectedMachine.subareaId}
Date:             ${formatDate(selectedMachine.date)}

--------------------------------------------------------------------------------
                            STATUS SUMMARY
--------------------------------------------------------------------------------

Current Status: ${selectedMachine.status.toUpperCase()}
${selectedMachine.status === 'normal' ? '✓ Machine is operating within normal parameters.' : ''}
${selectedMachine.status === 'satisfactory' ? '✓ Machine is operating satisfactorily.' : ''}
${selectedMachine.status === 'alert' ? '⚠ Machine requires attention - alert status detected.' : ''}
${selectedMachine.status === 'unacceptable' ? '✗ CRITICAL: Machine status is unacceptable - immediate action required!' : ''}

Connection Type: ${selectedMachine.type}
${selectedMachine.type === 'ONLINE' ? '✓ Machine is connected and transmitting data.' : '✗ Machine is offline - check connection.'}

--------------------------------------------------------------------------------
                          RECOMMENDATIONS
--------------------------------------------------------------------------------

${selectedMachine.status === 'normal' ? '• Continue regular maintenance schedule.\n• No immediate action required.' : ''}
${selectedMachine.status === 'satisfactory' ? '• Monitor for any changes in performance.\n• Schedule routine inspection within 30 days.' : ''}
${selectedMachine.status === 'alert' ? '• Schedule inspection within 7 days.\n• Check for unusual vibrations or sounds.\n• Review recent maintenance history.' : ''}
${selectedMachine.status === 'unacceptable' ? '• IMMEDIATE inspection required.\n• Consider taking machine offline.\n• Contact maintenance team urgently.\n• Document all findings.' : ''}

================================================================================
                        END OF REPORT
================================================================================
    `.trim();

    // Create and download the file
    const blob = new Blob([reportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Machine_Report_${selectedMachine.machineId}_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    setGeneratingReport(false);
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Loading state
  if (loading) {
    return (
      <div className="machines-table-container">
        <div className="table-loading">
          <Loader2 size={32} className="spinning" />
          <span>Loading machines...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="machines-table-container">
        <div className="table-error">
          <AlertTriangle size={32} />
          <span>Failed to load machines: {error}</span>
        </div>
      </div>
    );
  }

  // Empty state (no data at all)
  if (data.length === 0) {
    return (
      <div className="machines-table-container">
        <div className="table-empty-state">
          <Database size={48} />
          <h3>No Machines Available</h3>
          <p>No machine data has been loaded yet. Connect to your backend to see machines.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="machines-table-container">
      <div className="table-header">
        <div className="table-info">
          <h3>Machine Inventory</h3>
          <span className="table-count">
            Showing {startIndex + 1}-{Math.min(endIndex, filteredData.length)} of {filteredData.length} machines
          </span>
        </div>
        <div className="report-actions">
          {selectedMachine ? (
            <div className="selected-machine-info">
              <FileText size={16} />
              <span>Selected: <strong>{selectedMachine.machineName}</strong></span>
            </div>
          ) : (
            <div className="selected-machine-info no-selection">
              <FileText size={16} />
              <span>Select a machine to download report</span>
            </div>
          )}
          <button 
            className={`report-btn ${!selectedMachine ? 'report-btn-disabled' : ''}`}
            onClick={selectedMachine ? generateReport : undefined}
            disabled={!selectedMachine || generatingReport}
            title={!selectedMachine ? 'Select a machine first' : 'Download report for selected machine'}
          >
            {generatingReport ? (
              <>
                <Loader2 size={16} className="spinning" />
                Generating...
              </>
            ) : (
              <>
                <Download size={16} />
                Download Report
              </>
            )}
          </button>
        </div>
      </div>

      <div className="table-wrapper">
        <table className="machines-table">
          <thead>
            <tr>
              <th className="select-column">Select</th>
              <th>Customer ID</th>
              <th>Machine Name</th>
              <th>Machine ID</th>
              <th>Status</th>
              <th>Type</th>
              <th>Area ID</th>
              <th>Subarea ID</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {currentData.length > 0 ? (
              currentData.map((machine, index) => (
                <tr 
                  key={machine.id} 
                  className={`${index % 2 === 0 ? 'row-even' : 'row-odd'} ${selectedMachine?.id === machine.id ? 'row-selected' : ''}`}
                  onClick={() => handleMachineSelect(machine)}
                >
                  <td className="select-column">
                    <input
                      type="radio"
                      name="machine-select"
                      checked={selectedMachine?.id === machine.id}
                      onChange={() => handleMachineSelect(machine)}
                      className="machine-radio"
                    />
                  </td>
                  <td className="cell-customer">{machine.customerId}</td>
                  <td className="cell-name">{machine.machineName}</td>
                  <td className="cell-id"><code>{machine.machineId}</code></td>
                  <td><StatusBadge status={machine.status} /></td>
                  <td><TypeBadge type={machine.type} /></td>
                  <td>{machine.areaId}</td>
                  <td>{machine.subareaId}</td>
                  <td className="cell-date">{formatDate(machine.date)}</td>
                  <td>
                    <button className="action-btn" title="View Details">
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="10" className="empty-state">
                  No machines found matching your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="table-footer">
        <div className="pagination-info">
          Page {currentPage} of {totalPages || 1}
        </div>
        <div className="pagination-controls">
          <button 
            className="page-btn"
            onClick={handlePrevPage}
            disabled={currentPage === 1}
          >
            <ChevronLeft size={18} />
            Previous
          </button>
          <div className="page-numbers">
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  className={`page-num ${currentPage === pageNum ? 'active' : ''}`}
                  onClick={() => setCurrentPage(pageNum)}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>
          <button 
            className="page-btn"
            onClick={handleNextPage}
            disabled={currentPage === totalPages || totalPages === 0}
          >
            Next
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default MachinesTable;
