import { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import PageContainer from './components/PageContainer';
import DateFilterBar from './components/DateFilterBar';
import KpiCardsRow from './components/KpiCardsRow';
import ChartsSection from './components/ChartsSection';
import MachineFilterBar from './components/MachineFilterBar';
import MachinesTable from './components/MachinesTable';
import MachineDetail from './components/MachineDetail';
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
  generateStatusTrendData,
  triggerAutoSync
} from './services/api';
import './App.css';

function App() {
  // Active page state (simple routing without React Router)
  const [activePage, setActivePage] = useState('dashboard');
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  
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
  const [statusOptions, setStatusOptions] = useState(['All', 'Normal', 'Satisfactory', 'Alert', 'Unacceptable']);
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
    toDate: today,
    searchField: 'autoDetect',
    searchQuery: ''
  });

  // Dashboard date filters
  const [dashboardFilters, setDashboardFilters] = useState({
    fromDate: weekAgo,
    toDate: today,
    status: 'All',
    customerId: 'All'
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
      // Fetch machines with date range and filters
      const response = await fetchMachines({
        date_from: filters.fromDate,
        date_to: filters.toDate,
        status: filters.status,
        customerId: filters.customerId
      });

      let machines = response.machines || [];
      console.log(`[Dashboard] Fetched ${machines.length} machines from ${response.source || 'api'}`);

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

    console.log('[fetchMachinesData] Called with filters:', filters);

    try {
      // Build filter params - only include non-'All' values
      const apiFilters = {
        date_from: filters.fromDate,
        date_to: filters.toDate
      };
      
      // Only add filters if they are not 'All'
      if (filters.customerId && filters.customerId !== 'All') {
        apiFilters.customerId = filters.customerId;
      }
      if (filters.areaId && filters.areaId !== 'All') {
        apiFilters.areaId = filters.areaId;
      }
      if (filters.status && filters.status !== 'All') {
        apiFilters.status = filters.status;
      }
      
      console.log('[fetchMachinesData] API filters:', apiFilters);
      
      const response = await fetchMachines(apiFilters);

      const machines = response.machines || [];
      console.log(`[Machines] Fetched ${machines.length} machines from ${response.source || 'api'}`);

      // Transform machines data for the table
      const transformedData = machines.map((machine, index) => ({
        id: machine._id || machine.machineId || `machine-${index}`,
        customerId: machine.customerId || 'N/A',
        machineName: machine.name || machine.machineName || 'Unknown',
        machineId: machine.machineId || machine._id || 'N/A',
        status: (machine.statusName || machine.status || 'normal').toLowerCase(),
        type: (machine.machineType && machine.machineType !== 'N/A' ? machine.machineType : machine.type || 'OFFLINE').toUpperCase(),
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

  // Auto-sync on initial load to keep data updated
  useEffect(() => {
    const performAutoSync = async () => {
      console.log('[App] Triggering auto-sync to check for updates...');
      const result = await triggerAutoSync();
      console.log('[App] Auto-sync result:', result);
      setSyncStatus(result);
      
      // If sync was triggered, refetch data after a short delay
      if (result.needs_sync) {
        console.log('[App] Sync in progress, will refresh data in 3 seconds...');
        setTimeout(() => {
          fetchDashboardData(dashboardFilters);
          fetchMachinesData(machineFilters);
        }, 3000);
      }
    };
    
    performAutoSync();
    
    // Also set up periodic sync check every 4 minutes
    const syncInterval = setInterval(performAutoSync, 4 * 60 * 1000);
    
    return () => clearInterval(syncInterval);
  }, []);

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
    console.log('handleMachineFilterApply called with:', filters);
    // Ensure 'All' values are passed correctly and include search params
    const cleanFilters = {
      areaId: filters.areaId || 'All',
      status: filters.status || 'All',
      customerId: filters.customerId || 'All',
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      // Include search parameters
      searchField: filters.searchField || 'machineName',
      searchQuery: filters.searchQuery || ''
    };
    console.log('Setting machine filters:', cleanFilters);
    setMachineFilters(cleanFilters);
  };

  // Handle dashboard date filter changes
  const handleDashboardFilterApply = (filters) => {
    setDashboardFilters(filters);
  };

  // Handle bar chart click - navigate to machines with specific date and status
  const handleBarChartClick = (date, status) => {
    console.log('Bar clicked:', date, status);
    // Set machine filters with the clicked date and status
    const newFilters = {
      areaId: 'All',
      customerId: 'All',
      status: status,
      fromDate: date,
      toDate: date
    };
    setMachineFilters(newFilters);
    // Reset selected machine and navigate to machines page
    setSelectedMachine(null);
    setActivePage('machines');
  };

  // Handle page change - reset selected machine
  const handlePageChange = (page) => {
    setSelectedMachine(null);
    setActivePage(page);
  };

  return (
    <div className="app">
      <Header activePage={activePage} onPageChange={handlePageChange} />
      
      {activePage === 'dashboard' && (
        <PageContainer 
          title="Dashboard Overview" 
          subtitle="Real-time factory monitoring and machine health analytics"
        >
          <DateFilterBar 
            onApplyFilter={handleDashboardFilterApply}
            statusOptions={statusOptions}
            customerOptions={customerOptions}
            initialFilters={dashboardFilters}
          />
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
            onBarClick={handleBarChartClick}
          />
        </PageContainer>
      )}

      {activePage === 'machines' && !selectedMachine && (
        <PageContainer 
          title="Machine Inventory" 
          subtitle="View and manage all factory machines"
        >
          <MachineFilterBar 
            onApplyFilter={handleMachineFilterApply}
            areaOptions={areaOptions}
            statusOptions={statusOptions}
            customerOptions={customerOptions}
            initialFilters={machineFilters}
            machinesData={machinesData}
          />
          <MachinesTable 
            data={machinesData} 
            filters={machineFilters}
            loading={loading.machines}
            error={errors.machines}
            onMachineClick={(machine) => setSelectedMachine(machine)}
          />
        </PageContainer>
      )}

      {activePage === 'machines' && selectedMachine && (
        <PageContainer 
          title="Machine Details" 
          subtitle="Detailed machine information and bearing data"
        >
          <MachineDetail 
            machineId={selectedMachine.machineId || selectedMachine.id}
            machineInfo={selectedMachine}
            onBack={() => setSelectedMachine(null)}
          />
        </PageContainer>
      )}
    </div>
  );
}

export default App;
