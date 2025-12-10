import { Factory, LayoutDashboard, Cpu } from 'lucide-react';
import './Header.css';

const Header = ({ activePage, onPageChange }) => {
  return (
    <header className="header">
      <div className="header-container">
        {/* Logo & App Name */}
        <div className="header-brand">
          <Factory className="brand-icon" />
          <span className="brand-name">Factory Monitor</span>
        </div>

        {/* Navigation */}
        <nav className="header-nav">
          <button
            className={`nav-btn ${activePage === 'dashboard' ? 'active' : ''}`}
            onClick={() => onPageChange('dashboard')}
          >
            <LayoutDashboard size={18} />
            <span>Dashboard</span>
          </button>
          <button
            className={`nav-btn ${activePage === 'machines' ? 'active' : ''}`}
            onClick={() => onPageChange('machines')}
          >
            <Cpu size={18} />
            <span>Machines</span>
          </button>
        </nav>

        {/* Right Section */}
        <div className="header-right">
          <span className="status-indicator">
            <span className="status-dot"></span>
            System Online
          </span>
        </div>
      </div>
    </header>
  );
};

export default Header;
