/**
 * FileManager using Adapter Pattern
 * Handles file import/export operations
 */
import { Serializer } from './Serializer.js';

export class FileManager {
    constructor(tabManager, serializer) {
        this.tabManager = tabManager;
        // Use Serializer class directly (all methods are static)
        this.serializer = Serializer;
    }
    
    /**
     * Export to file (.pds format)
     * @param {string} filename - Optional filename
     */
    exportToFile(filename = null) {
        try {
            const json = Serializer.serialize(this.tabManager);
            const defaultFilename = filename || `nova_otto_${new Date().toISOString().split('T')[0]}.pds`;
            this.createDownload(json, defaultFilename);
            return true;
        } catch (error) {
            console.error('Export error:', error);
            return false;
        }
    }
    
    /**
     * Import from file
     * @param {File} file 
     * @returns {Promise<TabManager|null>}
     */
    async importFromFile(file) {
        try {
            if (!file) {
                throw new Error('No file provided');
            }
            
            // Check file extension
            if (!file.name.endsWith('.pds')) {
                throw new Error('Invalid file format. Expected .pds file');
            }
            
            const content = await this.readFile(file);
            const tabManager = await Serializer.deserialize(content);
            
            return tabManager;
        } catch (error) {
            console.error('Import error:', error);
            alert(`Error importing file: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Show import dialog
     * @returns {Promise<TabManager|null>}
     */
    showImportDialog() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.pds';
            
            input.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (file) {
                    const tabManager = await this.importFromFile(file);
                    resolve(tabManager);
                } else {
                    resolve(null);
                }
            });
            
            // Trigger file dialog
            input.click();
        });
    }
    
    /**
     * Create a download
     * @param {string} content - File content
     * @param {string} filename - Filename
     */
    createDownload(content, filename) {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
    
    /**
     * Read file content
     * @param {File} file 
     * @returns {Promise<string>}
     */
    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                resolve(e.target.result);
            };
            
            reader.onerror = (e) => {
                reject(new Error('Failed to read file'));
            };
            
            reader.readAsText(file);
        });
    }
}
