
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TerminalIcon } from './icons/TerminalIcon';
import { FileSystemState } from '../types';
import { executeCommand } from '../services/fileSystemService';

interface TerminalWindowProps {
  fileSystem: FileSystemState;
  onUpdateFileSystem: (newState: FileSystemState) => void;
  onClose: () => void;
}

export const TerminalWindow: React.FC<TerminalWindowProps> = ({ fileSystem, onUpdateFileSystem, onClose }) => {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<{cmd: string, output: string}[]>([]);
  
  const [position, setPosition] = useState({ x: 50, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const windowRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (windowRef.current && (e.target as HTMLElement).closest('.drag-handle')) {
        setIsDragging(true);
        const rect = windowRef.current.getBoundingClientRect();
        setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        e.preventDefault();
    }
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
      if (!isDragging) return;
      setPosition({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
  }, [isDragging, dragOffset]);

  const handleMouseUp = useCallback(() => { setIsDragging(false); }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim()) return;
      
      const { output, newState } = executeCommand(fileSystem, input);
      setHistory(prev => [...prev, { cmd: input, output }]);
      onUpdateFileSystem(newState);
      setInput('');
  };

  return (
    <div
      ref={windowRef}
      className="fixed z-40 w-full max-w-2xl bg-black/90 text-green-400 font-mono rounded-lg shadow-2xl flex flex-col border border-gray-700"
      style={{ top: `${position.y}px`, left: `${position.x}px`, height: '400px' }}
      onMouseDown={handleMouseDown}
    >
      <header className="drag-handle p-2 border-b border-gray-700 flex justify-between items-center cursor-move bg-gray-900 rounded-t-lg">
        <div className="flex items-center space-x-2">
            <TerminalIcon className="w-5 h-5 text-green-500"/>
            <span className="text-sm font-bold text-gray-200">restricted_user@nexus: {fileSystem.currentPath}</span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white font-bold px-2">&times;</button>
      </header>
      
      <div className="flex-1 p-4 overflow-y-auto space-y-2">
        <div className="text-xs text-gray-500 mb-4">AI Nexus OS v1.0.0 (Simulated Environment)</div>
        
        {history.map((entry, i) => (
            <div key={i} className="space-y-1">
                <div className="flex">
                    <span className="text-blue-400 mr-2">$</span>
                    <span>{entry.cmd}</span>
                </div>
                {entry.output && (
                    <div className="whitespace-pre-wrap text-gray-300 pl-4 border-l-2 border-gray-700">
                        {entry.output}
                    </div>
                )}
            </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-2 border-t border-gray-700 bg-gray-900 rounded-b-lg flex items-center">
          <span className="text-blue-400 mr-2">$</span>
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-green-400 placeholder-green-400/30"
            placeholder="Enter command..."
            autoFocus
          />
      </form>
    </div>
  );
};
