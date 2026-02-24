'use client';

import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import type { CoverageSummary, FileCoverage } from '@/lib/qa/coverageParser';

interface HeatmapProps {
  isOpen: boolean;
  onClose: () => void;
  summary: CoverageSummary;
  files: FileCoverage[];
}

interface BuildingProps {
  position: [number, number, number];
  size: number;
  coverage: number; // 0-100
  file: FileCoverage;
}

function Building({ position, size, coverage, file }: BuildingProps) {
  const [hovered, setHover] = useState(false);

  // Base Color mapping (0% = Red, 50% = Yellow, 100% = Green)
  const r = coverage < 50 ? 255 : Math.floor(255 - ((coverage - 50) * 255) / 50);
  const g = coverage > 50 ? 255 : Math.floor((coverage * 255) / 50);
  const b = 0;
  const color = `rgb(${r},${g},${b})`;

  // Height: size is normalized 0-1.
  const height = Math.max(0.5, size * 10);
  const yOffset = height / 2;

  // Risk emissive
  const risk = size * (1 - Math.min(100, Math.max(0, coverage)) / 100);
  const emissiveColor = '#ff0000';
  const emissiveIntensity = risk * 2; // glow intensity

  return (
    <group position={[position[0], position[1] + yOffset, position[2]]}>
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
      >
        <boxGeometry args={[1.5, height, 1.5]} />
        <meshStandardMaterial
          color={color}
          emissive={emissiveColor}
          emissiveIntensity={hovered ? emissiveIntensity + 0.5 : emissiveIntensity}
          roughness={0.3}
          metalness={0.2}
        />
      </mesh>

      {hovered && (
        <Html position={[0, height / 2 + 1, 0]} center zIndexRange={[100, 0]}>
          <div className="bg-black/90 text-white px-3 py-2 rounded-lg text-xs border border-white/20 pointer-events-none shadow-xl min-w-[150px]">
            <strong
              className="block mb-1 text-primary-light truncate max-w-[200px]"
              title={file.path}
            >
              {file.path.split('/').pop()}
            </strong>
            <div
              className="text-white/70 text-[10px] mb-2 truncate max-w-[200px]"
              title={file.path}
            >
              {file.path}
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <span className="text-white/50">Coverage:</span>
              <span
                className={`font-bold tabular-nums text-right ${coverage >= 80 ? 'text-emerald-400' : coverage >= 50 ? 'text-amber-400' : 'text-rose-400'}`}
              >
                {Math.round(coverage)}%
              </span>

              <span className="text-white/50">Size/Cmplx:</span>
              <span className="font-bold tabular-nums text-right text-white">{file.size}</span>

              {risk > 0.2 && (
                <>
                  <span className="text-white/50">Risk Factor:</span>
                  <span className="font-bold tabular-nums text-right text-rose-500">High</span>
                </>
              )}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

export function CoverageHeatmapModal({ isOpen, onClose, summary: _summary, files }: HeatmapProps) {
  const buildings = useMemo(() => {
    // Sort files by path to group folders visually together in the grid
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
    const maxSize = Math.max(...sorted.map((f) => f.size), 1);

    const count = sorted.length;
    const gridCols = Math.ceil(Math.sqrt(count));

    // Center the grid around origin (0,0)
    const gridSize = 2.5; // spacing between buildings
    const startX = -((gridCols - 1) * gridSize) / 2;
    const startZ = -((gridCols - 1) * gridSize) / 2;

    return sorted.map((file, index) => {
      const col = index % gridCols;
      const row = Math.floor(index / gridCols);
      const x = startX + col * gridSize;
      const z = startZ + row * gridSize;

      return {
        key: file.path,
        file,
        position: [x, 0, z] as [number, number, number],
        normalizedSize: file.size / maxSize, // 0 to 1
        coverage: file.lines,
      };
    });
  }, [files]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative z-10 flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0e0e14] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 bg-white/2 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-xl text-primary">3d_rotation</span>
            <h2 className="text-sm font-bold tracking-wide text-foreground">
              3D Coverage Code City
            </h2>
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold text-foreground-muted">
              {files.length} files
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* 3D Canvas wrapper */}
        <div className="flex-1 relative bg-black/30">
          <Canvas camera={{ position: [0, 20, 30], fov: 45 }}>
            <color attach="background" args={['#0e0e14']} />

            <ambientLight intensity={0.4} />
            <directionalLight position={[10, 20, 10]} intensity={1.5} castShadow />
            <pointLight position={[-10, -10, -10]} intensity={0.5} />

            <OrbitControls
              makeDefault
              maxPolarAngle={Math.PI / 2 - 0.05} // Prevent camera from going under the floor
              minDistance={5}
              maxDistance={150}
            />

            {/* Floor Plane */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
              <planeGeometry args={[200, 200]} />
              <meshStandardMaterial color="#13131a" roughness={0.9} />
            </mesh>

            {/* Grid helper */}
            <gridHelper args={[200, 50, '#222', '#111']} position={[0, -0.09, 0]} />

            <group>
              {buildings.map((b) => (
                <Building
                  key={b.key}
                  file={b.file}
                  position={b.position}
                  size={b.normalizedSize}
                  coverage={b.coverage}
                />
              ))}
            </group>
          </Canvas>

          {/* Controls hint */}
          <div className="absolute top-4 left-4 pointer-events-none flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-full border border-white/5 backdrop-blur-sm">
            <span className="material-symbols-outlined text-[14px] text-white/50">touch_app</span>
            <span className="text-[10px] font-medium text-white/60">
              Drag to rotate • Scroll to zoom
            </span>
          </div>

          {/* Legend Overlay */}
          <div className="absolute bottom-4 left-4 bg-[#0e0e14]/90 border border-white/10 p-4 rounded-xl backdrop-blur-md pointer-events-none min-w-[180px]">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-foreground-muted mb-3">
              Legend
            </h3>

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-[rgb(255,0,0)] rounded-sm shadow-[0_0_8px_rgba(255,0,0,0.4)]"></div>
                <span className="text-xs text-foreground font-medium">0% Coverage</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-[rgb(255,255,0)] rounded-sm shadow-[0_0_8px_rgba(255,255,0,0.4)]"></div>
                <span className="text-xs text-foreground font-medium">50% Coverage</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-[rgb(0,255,0)] rounded-sm shadow-[0_0_8px_rgba(0,255,0,0.4)]"></div>
                <span className="text-xs text-foreground font-medium">100% Coverage</span>
              </div>
            </div>

            <div className="border-t border-white/10 pt-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px] text-white/50">height</span>
                <span className="text-[10px] text-white/70">Building height = File size</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px] text-rose-500">
                  local_fire_department
                </span>
                <span className="text-[10px] text-rose-400">Red glow = High risk zone</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
