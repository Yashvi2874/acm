/**
 * Procedural Earth texture generator
 * Creates realistic Earth textures using canvas for day/night, clouds, and normal maps
 */

export function createEarthDayTexture(size: number = 2048): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d')!;

  // Ocean base gradient
  const oceanGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  oceanGradient.addColorStop(0, '#1a4a7a');
  oceanGradient.addColorStop(0.5, '#0a3a5a');
  oceanGradient.addColorStop(1, '#1a4a7a');
  ctx.fillStyle = oceanGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Simplified continent shapes (procedural)
  const continents = [
    // North America
    { x: 0.15, y: 0.25, w: 0.18, h: 0.25, color: '#2d5a27' },
    // South America
    { x: 0.22, y: 0.55, w: 0.12, h: 0.25, color: '#3d6a27' },
    // Europe & Africa
    { x: 0.48, y: 0.28, w: 0.15, h: 0.45, color: '#c4a35a' },
    // Asia
    { x: 0.65, y: 0.22, w: 0.25, h: 0.35, color: '#4a7a37' },
    // Australia
    { x: 0.82, y: 0.58, w: 0.12, h: 0.18, color: '#c4935a' },
    // Antarctica
    { x: 0, y: 0.92, w: 1, h: 0.08, color: '#e8e8e8' },
    // Greenland
    { x: 0.28, y: 0.15, w: 0.08, h: 0.12, color: '#e0e0e0' },
  ];

  continents.forEach(cont => {
    ctx.fillStyle = cont.color;
    const cx = cont.x * canvas.width;
    const cy = cont.y * canvas.height;
    const cw = cont.w * canvas.width;
    const ch = cont.h * canvas.height;
    
    // Irregular shape with noise
    ctx.beginPath();
    ctx.moveTo(cx, cy + ch * 0.5);
    for (let i = 0; i <= 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const radiusX = cw / 2 * (0.8 + Math.random() * 0.4);
      const radiusY = ch / 2 * (0.8 + Math.random() * 0.4);
      const px = cx + cw / 2 + Math.cos(angle) * radiusX;
      const py = cy + ch / 2 + Math.sin(angle) * radiusY;
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  });

  // Add some terrain variation
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = Math.random() * 3 + 1;
    ctx.fillStyle = `rgba(${Math.floor(Math.random() * 50)}, ${Math.floor(Math.random() * 80 + 50)}, ${Math.floor(Math.random() * 50)}, 0.3)`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

export function createEarthNightTexture(size: number = 2048): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d')!;

  // Dark ocean
  ctx.fillStyle = '#0a1a2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // City lights clusters
  const cities = [
    // Eastern US
    { x: 0.18, y: 0.35, density: 0.7 },
    // Western US
    { x: 0.12, y: 0.38, density: 0.5 },
    // Europe
    { x: 0.52, y: 0.32, density: 0.8 },
    // India
    { x: 0.68, y: 0.42, density: 0.75 },
    // Eastern China
    { x: 0.78, y: 0.38, density: 0.85 },
    // Japan
    { x: 0.85, y: 0.35, density: 0.7 },
    // Southeast Asia
    { x: 0.75, y: 0.48, density: 0.6 },
  ];

  cities.forEach(city => {
    const cx = city.x * canvas.width;
    const cy = city.y * canvas.height;
    const clusterSize = canvas.width * 0.08;

    for (let i = 0; i < 800 * city.density; i++) {
      const x = cx + (Math.random() - 0.5) * clusterSize;
      const y = cy + (Math.random() - 0.5) * clusterSize * 0.6;
      const brightness = Math.random() * 0.6 + 0.4;
      const size = Math.random() * 2 + 1;
      
      ctx.fillStyle = `rgba(255, ${Math.floor(200 + Math.random() * 55)}, ${Math.floor(100 + Math.random() * 50)}, ${brightness})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  return canvas;
}

export function createCloudTexture(size: number = 2048): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d')!;

  // Transparent background
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Generate cloud patterns
  const cloudBands = [
    { y: 0.2, intensity: 0.6 },
    { y: 0.35, intensity: 0.5 },
    { y: 0.5, intensity: 0.7 },
    { y: 0.65, intensity: 0.5 },
    { y: 0.8, intensity: 0.6 },
  ];

  cloudBands.forEach(band => {
    const cy = band.y * canvas.height;
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * canvas.width;
      const y = cy + (Math.random() - 0.5) * canvas.height * 0.15;
      const radius = Math.random() * 40 + 20;
      const opacity = Math.random() * 0.4 * band.intensity + 0.1;
      
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${opacity})`);
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Add storm systems
  for (let i = 0; i < 8; i++) {
    const cx = Math.random() * canvas.width;
    const cy = Math.random() * canvas.height;
    const spiralArms = 3 + Math.floor(Math.random() * 3);
    
    for (let arm = 0; arm < spiralArms; arm++) {
      const armAngle = (arm / spiralArms) * Math.PI * 2;
      for (let j = 0; j < 30; j++) {
        const dist = j * 3;
        const angle = armAngle + j * 0.15;
        const x = cx + Math.cos(angle) * dist;
        const y = cy + Math.sin(angle) * dist * 0.6;
        const radius = Math.max(1, 25 - j * 0.8);
        const opacity = Math.max(0, 0.5 - j * 0.015);
        
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(255, 255, 255, ${opacity})`);
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return canvas;
}

export function createSpecularMap(size: number = 2048): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d')!;

  // Ocean is reflective (white), land is not (black)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Black out continents (no reflection)
  const continents = [
    { x: 0.15, y: 0.25, w: 0.18, h: 0.25 },
    { x: 0.22, y: 0.55, w: 0.12, h: 0.25 },
    { x: 0.48, y: 0.28, w: 0.15, h: 0.45 },
    { x: 0.65, y: 0.22, w: 0.25, h: 0.35 },
    { x: 0.82, y: 0.58, w: 0.12, h: 0.18 },
  ];

  ctx.fillStyle = '#000000';
  continents.forEach(cont => {
    const cx = cont.x * canvas.width;
    const cy = cont.y * canvas.height;
    const cw = cont.w * canvas.width;
    const ch = cont.h * canvas.height;
    
    ctx.beginPath();
    ctx.ellipse(cx + cw / 2, cy + ch / 2, cw / 2, ch / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  return canvas;
}
