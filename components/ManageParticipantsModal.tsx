
import React, { useState } from 'react';
import { Character } from '../types.ts';
import { UserIcon } from './icons/UserIcon.tsx';
import { BookOpenIcon } from './icons/BookOpenIcon.tsx';

interface ManageParticipantsModalProps {
  allCharacters: Character[];
  currentParticipantIds: string[];
  onSave: (selectedIds: string[]) => void;
  onClose: () => void;
}

export const ManageParticipantsModal: React.FC<ManageParticipantsModalProps> = ({ allCharacters, currentParticipantIds, onSave, onClose }) => {
  const [selectedCharIds, setSelectedCharIds] = useState<Set<string>>(new Set(currentParticipantIds));

  const handleToggleCharacter = (id: string) => {
    setSelectedCharIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleSubmit = () => {
    if (selectedCharIds.size === 0) {
      alert('A chat must have at least one participant.');
      return;
    }
    onSave(Array.from(selectedCharIds));
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background-secondary rounded-lg shadow-xl w-full max-w-lg flex flex-col" onClick={e => e.stopPropagation()}>
        <header className="p-4 border-b border-border-neutral flex justify-between items-center flex-shrink-0">
          <h2 className="text-xl font-bold text-text-primary">Manage Participants</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors text-2xl font-bold leading-none p-1">&times;</button>
        </header>
        
        <div className="p-6 flex-1 overflow-y-auto max-h-[60vh]">
             <div className="space-y-2">
                {allCharacters.length === 0 ? (
                    <p className="text-text-secondary text-center p-4">No characters found.</p>
                ) : allCharacters.map(character => (
                    <div key={character.id} onClick={() => handleToggleCharacter(character.id)} className={`flex items-center p-2 rounded-md cursor-pointer transition-colors ${selectedCharIds.has(character.id) ? 'bg-primary-500/30' : 'hover:bg-background-tertiary'}`}>
                        <input
                            type="checkbox"
                            checked={selectedCharIds.has(character.id)}
                            readOnly
                            className="h-4 w-4 rounded border-border-strong bg-background-primary text-primary-500 focus:ring-primary-500 pointer-events-none"
                        />
                        <img src={character.avatarUrl || `https://picsum.photos/seed/${character.id}/40/40`} alt={character.name} className="w-8 h-8 rounded-full mx-3 flex-shrink-0"/>
                        <div className="flex items-center space-x-2 min-w-0">
                            <span className="font-medium text-text-primary truncate">{character.name}</span>
                            {character.characterType === 'narrator' 
                                ? <BookOpenIcon className="w-4 h-4 text-text-secondary flex-shrink-0" title="Narrator/Scenario"/> 
                                : <UserIcon className="w-4 h-4 text-text-secondary flex-shrink-0" title="Persona"/>}
                        </div>
                    </div>
                ))}
             </div>
        </div>

        <footer className="p-4 border-t border-border-neutral flex justify-end space-x-3">
            <button onClick={onClose} className="py-2 px-4 rounded-md text-text-primary bg-background-tertiary hover:bg-opacity-80 font-medium">
                Cancel
            </button>
            <button onClick={handleSubmit} className="py-2 px-4 rounded-md text-text-accent bg-primary-600 hover:bg-primary-500 font-medium">
                Save Changes
            </button>
        </footer>
      </div>
    </div>
  );
};
