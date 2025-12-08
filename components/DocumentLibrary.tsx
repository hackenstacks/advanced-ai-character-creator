
import React, { useState, useRef } from 'react';
import { RagSource } from '../types.ts';
import { TrashIcon } from './icons/TrashIcon.tsx';
import { UploadIcon } from './icons/UploadIcon.tsx';
import { ConfirmationRequest } from '../types.ts';
import { logger } from '../services/loggingService.ts';
import * as ragService from '../services/ragService.ts';
import { blobToBase64 } from '../services/geminiService.ts';

interface DocumentLibraryProps {
    documents: RagSource[];
    onUpdateDocuments: (docs: RagSource[]) => void;
    onSetConfirmation: (request: ConfirmationRequest | null) => void;
}

export const DocumentLibrary: React.FC<DocumentLibraryProps> = ({ documents, onUpdateDocuments, onSetConfirmation }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [indexingStatus, setIndexingStatus] = useState<string | null>(null);

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            setIndexingStatus(`Processing "${file.name}"...`);
            
            // Check if image
            if (file.type.startsWith('image/')) {
                const base64 = await blobToBase64(file);
                const newSource: RagSource = {
                    id: `source-${crypto.randomUUID()}`,
                    fileName: file.name,
                    fileType: file.type,
                    createdAt: new Date().toISOString(),
                    data: base64
                };
                // Images aren't "indexed" with vectors in this simple RAG implementation, 
                // they are just stored for direct injection into the chat context if selected.
                const updatedDocs = [...documents, newSource];
                onUpdateDocuments(updatedDocs);
                setIndexingStatus(`Successfully added image "${file.name}" to library!`);
            } else {
                // Assume text/markdown for standard RAG processing
                const tempConfig = {
                    service: 'gemini' as const,
                    apiKey: '', // Use default env key
                    model: 'text-embedding-004'
                };

                const newSource = await ragService.processAndIndexFile(file, tempConfig, (progress) => {
                    setIndexingStatus(progress);
                });

                const updatedDocs = [...documents, newSource];
                onUpdateDocuments(updatedDocs);
                setIndexingStatus(`Successfully added "${file.name}" to library!`);
            }

        } catch (error) {
            logger.error("File processing failed:", error);
            setIndexingStatus(`Error processing "${file.name}": ${error instanceof Error ? error.message : "Unknown error"}`);
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = "";
            setTimeout(() => setIndexingStatus(null), 5000);
        }
    };

    const handleDelete = (docId: string) => {
        const docName = documents.find(d => d.id === docId)?.fileName || 'Unknown';
        onSetConfirmation({
            message: `Are you sure you want to delete "${docName}" from the library? This will remove it from ALL characters using it.`,
            onConfirm: async () => {
                try {
                    await ragService.deleteSource(docId);
                    const updatedDocs = documents.filter(d => d.id !== docId);
                    onUpdateDocuments(updatedDocs);
                    logger.log(`Deleted document: ${docName}`);
                } catch (e) {
                    logger.error("Failed to delete document", e);
                }
                onSetConfirmation(null);
            },
            onCancel: () => onSetConfirmation(null),
        });
    };

    return (
        <div className="flex-1 flex flex-col h-full">
            <header className="p-4 border-b border-border-neutral flex justify-between items-center flex-shrink-0">
                <h2 className="text-xl font-bold text-text-primary">Knowledge Library</h2>
                <div className="flex space-x-2">
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".txt,.md,.pdf,image/png,image/jpeg,image/webp" className="hidden" disabled={!!indexingStatus} />
                    <button 
                        onClick={() => fileInputRef.current?.click()} 
                        disabled={!!indexingStatus}
                        className="flex items-center space-x-2 py-2 px-4 rounded-md text-text-accent bg-primary-600 hover:bg-primary-500 disabled:opacity-50"
                    >
                        <UploadIcon className="w-5 h-5" />
                        <span>Upload File</span>
                    </button>
                </div>
            </header>
            
            {indexingStatus && (
                <div className="bg-primary-500/10 text-primary-600 p-2 text-center text-sm border-b border-primary-500/20">
                    {indexingStatus}
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {documents.length === 0 ? (
                    <div className="text-center py-10 text-text-secondary">
                        <p>Your library is empty.</p>
                        <p className="text-sm mt-2">Upload text documents or images here to create a shared knowledge base for your characters.</p>
                    </div>
                ) : (
                    documents.map(doc => (
                        <div key={doc.id} className="bg-background-primary p-4 rounded-lg border border-border-neutral flex justify-between items-center group">
                            <div className="flex items-center space-x-3">
                                {doc.fileType.startsWith('image/') && (
                                    <div className="w-10 h-10 bg-background-tertiary rounded flex items-center justify-center overflow-hidden">
                                        <img src={`data:${doc.fileType};base64,${doc.data}`} alt="thumb" className="w-full h-full object-cover" />
                                    </div>
                                )}
                                <div>
                                    <h3 className="font-semibold text-text-primary">{doc.fileName}</h3>
                                    <p className="text-xs text-text-secondary">Added: {new Date(doc.createdAt).toLocaleDateString()}</p>
                                </div>
                            </div>
                            <button 
                                onClick={() => handleDelete(doc.id)} 
                                className="p-2 text-text-secondary hover:text-accent-red opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Delete from Library"
                            >
                                <TrashIcon className="w-5 h-5" />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
