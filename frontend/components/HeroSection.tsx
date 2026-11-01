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
          src="/images/pharmacy-hero.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-slate-950/55" aria-hidden="true" />
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
