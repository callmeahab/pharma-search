import React from 'react';
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { useIsMobile } from '@/hooks/use-mobile';
import Image from "next/image";

const HeroSection = () => {
  const isMobile = useIsMobile();
  
  return (
    <div className="relative mb-10">
      <AspectRatio ratio={isMobile ? 16 / 9 : 3 / 1} className="bg-muted overflow-hidden rounded-lg">
        <Image 
          src="/lovable-uploads/dc9443f8-c0b9-4cef-b371-25aa23f36278.png" 
          alt="" 
          layout="fill" 
          objectFit="cover" 
          className="object-cover w-full h-full brightness-[0.8]"
        />
        <div className="absolute inset-0 flex flex-col justify-center items-center text-center p-4 md:p-10">
          <div className="p-4 md:p-6 rounded-lg max-w-4xl">
            <h1 className="text-2xl md:text-4xl font-bold mb-2 md:mb-3">
              <span className="text-green-400 dark:text-green-300">Apo</span>
              <span className="text-green-600 dark:text-green-600">šteka</span>
            </h1>
            <p className="text-lg md:text-xl text-white mb-2 md:mb-3">
              Najbolji izbor farmaceutskih proizvoda, fitnes suplemenata i opreme
            </p>
            <p className="text-xs md:text-base text-white/90">
              Otkrijte, uporedite i uštedite na lekovima, dodacima ishrani, fitnes suplementima, rekvizitima i opremi – sve na jednom mestu.
            </p>
          </div>
        </div>
      </AspectRatio>
    </div>
  );
};

export default HeroSection;
