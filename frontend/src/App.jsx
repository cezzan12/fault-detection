import { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import PageContainer from './components/PageContainer';
import DateFilterBar from './components/DateFilterBar';
import KpiCardsRow from './components/KpiCardsRow';
import ChartsSection from './components/ChartsSection';
import MachineFilterBar from './components/MachineFilterBar';
import MachinesTable from './components/MachinesTable';
import {
  defaultKpiData,
  defaultCustomerTrendData,
  defaultStatusTrendData,
  defaultMachinesData,
  defaultAreaOptions,
  defaultStatusOptions,
  defaultCustomerOptions
} from './data/mockData';
import {
  fetchMachines,
  calculateKpiFromMachines,
  extractFilterOptions,
  generateCustomerTrendData,
  generateStatusTrendData
} from './services/api';
import './App.css';

function App() {
  // Active page state (simple routing without React Router)
  const [activePage, setActivePage] = useState('dashboard');
  
  // Loading states
  const [loading, setLoading] = useState({
    kpi: false,
    customerTrend: false,
    statusTrend: false,
    machines: false,
    filters: false
  });

  // Error states
  const [errors, setErrors] = useState({
    kpi: null,
    customerTrend: null,
    statusTrend: null,
    machines: null,
    filters: null
  });

  // Data states - initialized with defaults (will be replaced by API data)
  const [kpiData, setKpiData] = useState(defaultKpiData);
  const [customerTrendData, setCustomerTrendData] = useState(defaultCustomerTrendData);
  const [statusTrendData, setStatusTrendData] = useState(defaultStatusTrendData);
  const [machinesData, setMachinesData] = useState(defaultMachinesData);
  const [rawMachinesData, setRawMachinesData] = useState([]); // Store raw data for filtering
  
  // Filter options states
  const [areaOptions, setAreaOptions] = useState(defaultAreaOptions);
  const [statusOptions, setStatusOptions] = useState(defaultStatusOptions);
  const [customerOptions, setCustomerOptions] = useState(defaultCustomerOptions);

  // Get today's date for default filters
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Machine filters state
  const [machineFilters, setMachineFilters] = useState({
    areaId: 'All',
    status: 'All',
    customerId: 'All',
    fromDate: weekAgo,
    toDate: today
  });

  // Dashboard date filters
  const [dashboardFilters, setDashboardFilters] = useState({
    fromDate: weekAgo,
    toDate: today
  });

  // ==========================================
  // DATA FETCHING FUNCTIONS
  // ==========================================

  // Fetch all dashboard data (machines, then derive KPIs and trends)
  const fetchDashboardData = useCallback(async (filters = {}) => {
    // Set all loading states
    setLoading(prev => ({
      ...prev,
      kpi: true,
      customerTrend: true,
      statusTrend: true
    }));
    setErrors(prev => ({
      ...prev,
      kpi: null,
      customerTrend: null,
      statusTrend: null
    }));

    try {
      // Fetch machines with date range
      const response = await fetchMachines({
        date_from: filters.fromDate,
        date_to: filters.toDate
      });

      const machines = response.machines || [];
      console.log(`[Dashboard] Fetched ${machines.length} machines`);

      // Calculate KPI from machines
      const kpi = calculateKpiFromMachines(machines);
      setKpiData(kpi);

      // Generate customer trend data
      const customerTrends = generateCustomerTrendData(machines);
      setCustomerTrendData(customerTrends);

      // Generate status trend data
      const statusTrends = generateStatusTrendData(machines);
      setStatusTrendData(statusTrends);

      // Extract filter options
      const filterOpts = extractFilterOptions(machines);
      setAreaOptions(filterOpts.areaOptions);
      setCustomerOptions(filterOpts.customerOptions);

    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setErrors(prev => ({
        ...prev,
        kpi: error.message,
        customerTrend: error.message,
        statusTrend: error.message
      }));
    } finally {
      setLoading(prev => ({
        ...prev,
        kpi: false,
        customerTrend: false,
        statusTrend: false
      }));
    }
  }, []);

  // Fetch machines data for the table
  const fetchMachinesData = useCallback(async (filters = {}) => {
    setLoading(prev => ({ ...prev, machines: true }));
    setErrors(prev => ({ ...prev, machines: null }));

    try {
      const response = await fetchMachines({
        date_from: filters.fromDate,
        date_to: filters.toDate,
        customerId: filters.customerId,
        areaId: filters.areaId,
        status: filters.status
      });

      const machines = response.machines || [];
      console.log(`[Machines] Fetched ${machines.length} machines`);

      // Transform machines data for the table
      const transformedData = machines.map((machine, index) => ({
        id: machine._id || machine.machineId || `machine-${index}`,
        customerId: machine.customerId || 'N/A',
        machineName: machine.name || machine.machineName || 'Unknown',
        machineId: machine.machineId || machine._id || 'N/A',
        status: (machine.statusName || machine.status || 'normal').toLowerCase(),
        type: machine.type || machine.machineType || 'OFFLINE',
        areaId: machine.areaId || 'N/A',
        subareaId: machine.subAreaId || 'N/A',
        date: machine.dataUpdatedTime ? machine.dataUpdatedTime.split('T')[0] : 'N/A'
      }));

      setMachinesData(transformedData);
      setRawMachinesData(transformedData);

      // Also update filter options from this data
      const filterOpts = extractFilterOptions(machines);
      setAreaOptions(filterOpts.areaOptions);
      setCustomerOptions(filterOpts.customerOptions);

    } catch (error) {
      console.error('Failed to fetch machines:', error);
      setErrors(prev => ({ ...prev, machines: error.message }));
    } finally {
      setLoading(prev => ({ ...prev, machines: false }));
    }
  }, []);

  // ==========================================
  // EFFECTS
  // ==========================================

  // Initial data load
  useEffect(() => {
    fetchDashboardData(dashboardFilters);
    fetchMachinesData(machineFilters);
  }, []);

  // Refetch dashboard data when filters change
  useEffect(() => {
    fetchDashboardData(dashboardFilters);
  }, [dashboardFilters, fetchDashboardData]);

  // Refetch machines when filters change
  useEffect(() => {
    fetchMachinesData(machineFilters);
  }, [machineFilters, fetchMachinesData]);

  // ==========================================
  // EVENT HANDLERS
  // ==========================================

  // Handle machine filter changes
  const handleMachineFilterApply = (filters) => {
    setMachineFilters(filters);
  };

  // Handle dashboard date filter changes
  const handleDashboardFilterApply = (filters) => {
    setDashboardFilters(filters);
  };

  return (
    <div className="app">
      <Header activePage={activePage} onPageChange={setActivePage} />
      
      {activePage === 'dashboard' && (
        <PageContainer 
          title="Dashboard Overview" 
          subtitle="Real-time factory monitoring and machine health analytics"
        >
          <DateFilterBar onApplyFilter={handleDashboardFilterApply} />
          <KpiCardsRow 
            data={kpiData} 
            loading={loading.kpi} 
            error={errors.kpi} 
          />
          <ChartsSection 
            customerTrendData={customerTrendData}
            statusTrendData={statusTrendData}
            loading={{
              customerTrend: loading.customerTrend,
              statusTrend: loading.statusTrend
            }}
            errors={{
              customerTrend: errors.customerTrend,
              statusTrend: errors.statusTrend
            }}
          />
        </PageContainer>
      )}

      {activePage === 'machines' && (
        <PageContainer 
          title="Machine Inventory" 
          subtitle="View and manage all factory machines"
        >
          <MachineFilterBar 
            onApplyFilter={handleMachineFilterApply}
            areaOptions={areaOptions}
            statusOptions={statusOptions}
            customerOptions={customerOptions}
          />
          <MachinesTable 
            data={machinesData} 
            filters={machineFilters}
            loading={loading.machines}
            error={errors.machines}
          />
        </PageContainer>
      )}
    </div>
  );
}

export default App;
