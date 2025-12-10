import { useState } from 'react';
import { Calendar, Filter, RefreshCw } from 'lucide-react';
import './DateFilterBar.css';

const DateFilterBar = ({ onApplyFilter }) => {
  const [fromDate, setFromDate] = useState('2025-12-01');
  const [toDate, setToDate] = useState('2025-12-09');
  const [status, setStatus] = useState('All');

  const handleApply = () => {
    const filters = { fromDate, toDate, status };
    console.log('Applying filters:', filters);
    if (onApplyFilter) {
      onApplyFilter(filters);
    }
  };

  const handleReset = () => {
    setFromDate('2025-12-01');
    setToDate('2025-12-09');
    setStatus('All');
    console.log('Filters reset');
  };

  return (
    <div className="filter-bar">
      <div className="filter-bar-header">
        <div className="filter-bar-title">
          <Filter size={18} />
          <span>Filters</span>
        </div>
      </div>
      
      <div className="filter-bar-content">
        <div className="filter-group">
          <label className="filter-label">From Date</label>
          <div className="input-wrapper">
            <Calendar size={16} className="input-icon" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="filter-input"
            />
          </div>
        </div>

        <div className="filter-group">
          <label className="filter-label">To Date</label>
          <div className="input-wrapper">
            <Calendar size={16} className="input-icon" />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="filter-input"
            />
          </div>
        </div>

        <div className="filter-group">
          <label className="filter-label">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="filter-select"
          >
            <option value="All">All Statuses</option>
            <option value="normal">Normal</option>
            <option value="satisfactory">Satisfactory</option>
            <option value="alert">Alert</option>
            <option value="unacceptable">Unacceptable</option>
          </select>
        </div>

        <div className="filter-actions">
          <button className="btn btn-secondary" onClick={handleReset}>
            <RefreshCw size={16} />
            Reset
          </button>
          <button className="btn btn-primary" onClick={handleApply}>
            <Filter size={16} />
            Apply Filter
          </button>
        </div>
      </div>
    </div>
  );
};

export default DateFilterBar;
