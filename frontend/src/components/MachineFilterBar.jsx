import { useState } from 'react';
import { Calendar, Filter, RefreshCw, MapPin, Users, Activity } from 'lucide-react';
import './MachineFilterBar.css';

const MachineFilterBar = ({ 
  onApplyFilter,
  areaOptions = ['All'],
  statusOptions = ['All'],
  customerOptions = ['All']
}) => {
  const [filters, setFilters] = useState({
    areaId: 'All',
    status: 'All',
    customerId: 'All',
    fromDate: '2025-12-01',
    toDate: '2025-12-09'
  });

  const handleChange = (field, value) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleApply = () => {
    console.log('Applying machine filters:', filters);
    if (onApplyFilter) {
      onApplyFilter(filters);
    }
  };

  const handleReset = () => {
    const resetFilters = {
      areaId: 'All',
      status: 'All',
      customerId: 'All',
      fromDate: '2025-12-01',
      toDate: '2025-12-09'
    };
    setFilters(resetFilters);
    console.log('Filters reset');
    if (onApplyFilter) {
      onApplyFilter(resetFilters);
    }
  };

  return (
    <div className="machine-filter-bar">
      <div className="filter-bar-header">
        <div className="filter-bar-title">
          <Filter size={18} />
          <span>Filter Machines</span>
        </div>
      </div>
      
      <div className="filter-bar-content">
        <div className="filter-row">
          <div className="filter-group">
            <label className="filter-label">
              <MapPin size={14} />
              Area ID
            </label>
            <select
              value={filters.areaId}
              onChange={(e) => handleChange('areaId', e.target.value)}
              className="filter-select"
            >
              {areaOptions.map(area => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">
              <Activity size={14} />
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => handleChange('status', e.target.value)}
              className="filter-select"
            >
              {statusOptions.map(status => (
                <option key={status} value={status}>
                  {status === 'All' ? 'All Statuses' : status.charAt(0).toUpperCase() + status.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">
              <Users size={14} />
              Customer ID
            </label>
            <select
              value={filters.customerId}
              onChange={(e) => handleChange('customerId', e.target.value)}
              className="filter-select"
            >
              {customerOptions.map(customer => (
                <option key={customer} value={customer}>
                  {customer === 'All' ? 'All Customers' : customer}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">
              <Calendar size={14} />
              From Date
            </label>
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => handleChange('fromDate', e.target.value)}
              className="filter-input"
            />
          </div>

          <div className="filter-group">
            <label className="filter-label">
              <Calendar size={14} />
              To Date
            </label>
            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => handleChange('toDate', e.target.value)}
              className="filter-input"
            />
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
    </div>
  );
};

export default MachineFilterBar;
