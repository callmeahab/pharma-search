
import React from 'react';
import { Settings, Heart } from 'lucide-react';

interface ProfileTabsProps {
  activeTab: 'settings' | 'wishlist';
  setActiveTab: (tab: 'settings' | 'wishlist') => void;
}

const ProfileTabs: React.FC<ProfileTabsProps> = ({ activeTab, setActiveTab }) => {
  return (
    <div className="border-b dark:border-gray-700">
      <nav className="flex overflow-x-auto">
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap ${
            activeTab === 'settings'
              ? 'border-health-primary text-health-primary dark:border-health-accent dark:text-health-accent'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <Settings className="mr-2 h-4 w-4" />
          Podešavanja
        </button>
        
        <button
          onClick={() => setActiveTab('wishlist')}
          className={`flex items-center px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap ${
            activeTab === 'wishlist'
              ? 'border-health-primary text-health-primary dark:border-health-accent dark:text-health-accent'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <Heart className="mr-2 h-4 w-4" />
          Lista želja
        </button>
      </nav>
    </div>
  );
};

export default ProfileTabs;
