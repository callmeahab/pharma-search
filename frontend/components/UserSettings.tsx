
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface UserData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
}

const UserSettings = () => {
  const [userData, setUserData] = useState<UserData>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: ''
  });
  
  const { toast } = useToast();
  
  // Load user data from localStorage
  useEffect(() => {
    const savedUserData = localStorage.getItem('userData');
    if (savedUserData) {
      try {
        const parsedData = JSON.parse(savedUserData);
        setUserData(prevData => ({
          ...prevData,
          ...parsedData
        }));
      } catch (error) {
        console.error('Failed to parse user data:', error);
      }
    }
  }, []);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setUserData(prev => ({
      ...prev,
      [name]: value
    }));
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Save to localStorage
    localStorage.setItem('userData', JSON.stringify(userData));
    
    toast({
      title: "Podešavanja ažurirana",
      description: "Vaše informacije su uspešno sačuvane."
    });
  };
  
  // Generate initials for avatar
  const getInitials = () => {
    if (userData.firstName && userData.lastName) {
      return `${userData.firstName[0]}${userData.lastName[0]}`.toUpperCase();
    }
    return 'KP'; // Default: Korisnički Profil
  };

  return (
    <div>
      <div className="flex items-center space-x-4 mb-6">
        <Avatar className="h-16 w-16">
          <AvatarImage src="" />
          <AvatarFallback className="bg-health-light text-health-primary dark:bg-gray-700 dark:text-health-accent text-lg">
            {getInitials()}
          </AvatarFallback>
        </Avatar>
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {userData.firstName ? `${userData.firstName} ${userData.lastName}` : 'Korisnik'}
          </h2>
          <p className="text-gray-500 dark:text-gray-400">{userData.email || 'korisnik@example.com'}</p>
        </div>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="firstName">Ime</Label>
            <Input 
              id="firstName"
              name="firstName"
              value={userData.firstName}
              onChange={handleChange}
              placeholder="Unesite vaše ime"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="lastName">Prezime</Label>
            <Input 
              id="lastName"
              name="lastName"
              value={userData.lastName}
              onChange={handleChange}
              placeholder="Unesite vaše prezime"
            />
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="email">Email adresa</Label>
          <Input 
            id="email"
            name="email"
            type="email"
            value={userData.email}
            onChange={handleChange}
            placeholder="Unesite vašu email adresu"
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="phone">Telefon</Label>
          <Input 
            id="phone"
            name="phone"
            value={userData.phone}
            onChange={handleChange}
            placeholder="Unesite vaš broj telefona"
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="address">Adresa</Label>
          <Input 
            id="address"
            name="address"
            value={userData.address}
            onChange={handleChange}
            placeholder="Unesite vašu adresu"
          />
        </div>
        
        <Button type="submit" className="bg-health-primary text-white hover:bg-health-primary/90 dark:bg-health-accent dark:hover:bg-health-accent/90">
          Sačuvaj izmene
        </Button>
      </form>
    </div>
  );
};

export default UserSettings;
