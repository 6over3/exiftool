import { parseMetadata, writeMetadata, dispose } from "./src/index";
import zeroperl from "@6over3/zeroperl-ts/zeroperl.wasm";

document.addEventListener('DOMContentLoaded', () => {
    console.log('WASM loaded:', zeroperl);
    let currentFileExtract: File | null = null;
    let currentFileWrite: File | null = null;
    let modifiedFileData: ArrayBuffer | null = null;

    // Tab switching
    const tabs = document.querySelectorAll<HTMLElement>('.tab');
    const tabContents = document.querySelectorAll<HTMLElement>('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            if (!targetTab) return;

            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));

            tab.classList.add('active');
            const targetContent = document.getElementById(`${targetTab}-tab`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });

    // Extract Tab Functionality
    setupExtractTab();
    setupWriteTab();

    function setupExtractTab(): void {
        const dropzone = document.getElementById('dropzone-extract') as HTMLDivElement;
        const fileInput = document.getElementById('fileInput-extract') as HTMLInputElement;
        const selectedFile = document.getElementById('selectedFile-extract') as HTMLDivElement;
        const fileName = document.getElementById('fileName-extract') as HTMLSpanElement;
        const fileSize = document.getElementById('fileSize-extract') as HTMLSpanElement;
        const removeFile = document.getElementById('removeFile-extract') as HTMLButtonElement;
        const runExifTool = document.getElementById('runExifTool-extract') as HTMLButtonElement;
        const resetBtn = document.getElementById('resetBtn-extract') as HTMLButtonElement;
        const spinner = document.getElementById('spinner-extract') as HTMLElement;
        const resultContainer = document.getElementById('resultContainer-extract') as HTMLDivElement;
        const status = document.getElementById('status-extract') as HTMLDivElement;
        const metadataOutput = document.getElementById('metadataOutput-extract') as HTMLPreElement;
        const copyBtn = document.getElementById('copyBtn-extract') as HTMLButtonElement;
        const downloadBtn = document.getElementById('downloadBtn-extract') as HTMLButtonElement;
        const jsonOutput = document.getElementById('jsonOutput-extract') as HTMLInputElement;
        const numericalOutput = document.getElementById('numericalOutput-extract') as HTMLInputElement;

        setupFileHandling(dropzone, fileInput, selectedFile, fileName, fileSize, removeFile,
            runExifTool, resetBtn, (file: File | null) => { currentFileExtract = file; });

        runExifTool.addEventListener('click', async () => {
            if (!currentFileExtract) return;

            spinner.style.display = 'inline-block';
            runExifTool.disabled = true;

            try {
                const args: string[] = [];
                if (jsonOutput.checked) args.push("-json");
                if (numericalOutput.checked) args.push("-n");

                const result = await parseMetadata(currentFileExtract, {
                    args: args,
                    transform: (data: string) => {
                        return jsonOutput.checked ? JSON.parse(data) : data;
                    }
                });

                if (result.success) {
                    showResults(resultContainer, status, metadataOutput, result.data);
                } else {
                    showError(resultContainer, status, metadataOutput, result.error);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to extract metadata';
                showError(resultContainer, status, metadataOutput, message);
            } finally {
                spinner.style.display = 'none';
                runExifTool.disabled = false;
            }
        });

        copyBtn.addEventListener('click', () => copyToClipboard(metadataOutput, copyBtn));
        downloadBtn.addEventListener('click', () => downloadJSON(metadataOutput, currentFileExtract));
    }

    function setupWriteTab(): void {
        const dropzone = document.getElementById('dropzone-write') as HTMLDivElement;
        const fileInput = document.getElementById('fileInput-write') as HTMLInputElement;
        const selectedFile = document.getElementById('selectedFile-write') as HTMLDivElement;
        const fileName = document.getElementById('fileName-write') as HTMLSpanElement;
        const fileSize = document.getElementById('fileSize-write') as HTMLSpanElement;
        const removeFile = document.getElementById('removeFile-write') as HTMLButtonElement;
        const writeMetadataBtn = document.getElementById('writeMetadata') as HTMLButtonElement;
        const resetBtn = document.getElementById('resetBtn-write') as HTMLButtonElement;
        const spinner = document.getElementById('spinner-write') as HTMLElement;
        const resultContainer = document.getElementById('resultContainer-write') as HTMLDivElement;
        const status = document.getElementById('status-write') as HTMLDivElement;
        const metadataEditor = document.getElementById('metadataEditor') as HTMLDivElement;
        const metadataFields = document.getElementById('metadataFields') as HTMLDivElement;
        const addField = document.getElementById('addField') as HTMLButtonElement;
        const downloadModified = document.getElementById('downloadModified') as HTMLButtonElement;
        const extractFromModified = document.getElementById('extractFromModified') as HTMLButtonElement;
        const downloadContainer = document.getElementById('downloadContainer') as HTMLDivElement;

        setupFileHandling(dropzone, fileInput, selectedFile, fileName, fileSize, removeFile,
            writeMetadataBtn, resetBtn, (file: File | null) => {
                currentFileWrite = file;
                metadataEditor.style.display = 'block';
            });

        // Common tags
        document.querySelectorAll<HTMLButtonElement>('.tag-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tag = btn.dataset.tag;
                if (tag) {
                    addMetadataField(metadataFields, tag, '');
                }
            });
        });

        addField.addEventListener('click', () => {
            addMetadataField(metadataFields, '', '');
        });

        writeMetadataBtn.addEventListener('click', async () => {
            if (!currentFileWrite) return;

            const tags: Record<string, string> = {};
            const fields = metadataFields.querySelectorAll<HTMLDivElement>('.metadata-field');

            fields.forEach(field => {
                const tagInput = field.querySelector<HTMLInputElement>('input[placeholder="Tag name"]');
                const valueInput = field.querySelector<HTMLInputElement>('input[placeholder="Value"]');
                
                if (!tagInput || !valueInput) return;
                
                const tag = tagInput.value.trim();
                const value = valueInput.value.trim();

                if (tag && value) {
                    tags[tag] = value;
                }
            });

            if (Object.keys(tags).length === 0) {
                showError(resultContainer, status, null, 'Please add at least one metadata field');
                return;
            }

            spinner.style.display = 'inline-block';
            writeMetadataBtn.disabled = true;

            try {
                const result = await writeMetadata(currentFileWrite, tags);

                if (result.success) {
                    modifiedFileData = result.data;
                    showWriteSuccess(resultContainer, status, downloadContainer);
                } else {
                    showError(resultContainer, status, null, result.error);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to write metadata';
                showError(resultContainer, status, null, message);
            } finally {
                spinner.style.display = 'none';
                writeMetadataBtn.disabled = false;
            }
        });

        downloadModified.addEventListener('click', () => {
            if (modifiedFileData && currentFileWrite) {
                const blob = new Blob([modifiedFileData], { type: currentFileWrite.type || 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `modified_${currentFileWrite.name}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
        });

        extractFromModified.addEventListener('click', async () => {
            if (modifiedFileData && currentFileWrite) {
                const modifiedFile = new File([modifiedFileData], currentFileWrite.name, { type: currentFileWrite.type });

                try {
                    const result = await parseMetadata(modifiedFile, {
                        args: ["-json"],
                        transform: (data: string) => JSON.parse(data)
                    });

                    if (result.success) {
                        alert('Metadata extracted! Check the Extract tab for results.');
                        // Switch to extract tab and show results
                        const extractTab = document.querySelector<HTMLElement>('.tab[data-tab="extract"]');
                        if (extractTab) extractTab.click();
                        
                        const extractOutput = document.getElementById('metadataOutput-extract') as HTMLPreElement;
                        const extractStatus = document.getElementById('status-extract') as HTMLDivElement;
                        const extractContainer = document.getElementById('resultContainer-extract') as HTMLDivElement;
                        showResults(extractContainer, extractStatus, extractOutput, result.data);
                    }
                } catch (_error) {
                    alert('Failed to extract metadata from modified file');
                }
            }
        });
    }

    function setupFileHandling(
        dropzone: HTMLDivElement,
        fileInput: HTMLInputElement,
        selectedFile: HTMLDivElement,
        fileName: HTMLSpanElement,
        fileSize: HTMLSpanElement,
        removeFile: HTMLButtonElement,
        actionBtn: HTMLButtonElement,
        resetBtn: HTMLButtonElement,
        onFileSelect: (file: File | null) => void
    ): void {
        fileInput.addEventListener('change', (_e: Event) => {
            if (fileInput.files && fileInput.files.length > 0) {
                handleFileSelection(fileInput.files[0]);
            }
        });

        (['dragenter', 'dragover', 'dragleave', 'drop'] as const).forEach(eventName => {
            dropzone.addEventListener(eventName, (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        dropzone.addEventListener('dragenter', () => {
            dropzone.style.backgroundColor = 'var(--light-gray)';
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.style.backgroundColor = '';
        });

        dropzone.addEventListener('drop', (e: DragEvent) => {
            dropzone.style.backgroundColor = '';
            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                handleFileSelection(e.dataTransfer.files[0]);
            }
        });

        dropzone.addEventListener('click', () => {
            fileInput.click();
        });

        function handleFileSelection(file: File): void {
            onFileSelect(file);
            fileName.textContent = file.name;
            fileSize.textContent = formatFileSize(file.size);
            selectedFile.style.display = 'flex';
            dropzone.style.display = 'none';
            actionBtn.disabled = false;
            resetBtn.disabled = false;
        }

        removeFile.addEventListener('click', () => {
            resetUI();
        });

        resetBtn.addEventListener('click', () => {
            resetUI();
        });

        function resetUI(): void {
            onFileSelect(null);
            fileInput.value = '';
            selectedFile.style.display = 'none';
            dropzone.style.display = 'block';
            actionBtn.disabled = true;
            resetBtn.disabled = true;

            // Reset metadata editor if it exists
            const metadataEditor = document.getElementById('metadataEditor');
            const resultContainer = dropzone.closest('.box')?.parentElement?.querySelector<HTMLDivElement>('.result-container');
            if (metadataEditor) {
                metadataEditor.style.display = 'none';
                const metadataFieldsContainer = document.getElementById('metadataFields');
                if (metadataFieldsContainer) {
                    metadataFieldsContainer.innerHTML = '';
                }
            }
            if (resultContainer) {
                resultContainer.style.display = 'none';
            }
        }
    }

    function addMetadataField(container: HTMLDivElement, tag: string = '', value: string = ''): void {
        const field = document.createElement('div');
        field.className = 'metadata-field';
        field.innerHTML = `
                    <input type="text" placeholder="Tag name" value="${tag}">
                    <input type="text" placeholder="Value" value="${value}">
                    <button type="button">×</button>
                `;

        const removeBtn = field.querySelector('button');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                field.remove();
            });
        }

        container.appendChild(field);

        // Focus the first empty input
        const inputs = field.querySelectorAll<HTMLInputElement>('input');
        if (!tag && inputs[0]) inputs[0].focus();
        else if (!value && inputs[1]) inputs[1].focus();
    }

    function formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
    }

    function showResults(
        resultContainer: HTMLDivElement,
        status: HTMLDivElement,
        metadataOutput: HTMLPreElement,
        data: unknown
    ): void {
        resultContainer.style.display = 'block';
        status.className = 'status-message';
        status.style.display = 'block';
        status.textContent = 'Metadata extracted successfully!';

        const output = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        metadataOutput.textContent = output;
    }

    function showError(
        resultContainer: HTMLDivElement,
        status: HTMLDivElement,
        metadataOutput: HTMLPreElement | null,
        message: string
    ): void {
        resultContainer.style.display = 'block';
        status.className = 'status-message status-error';
        status.style.display = 'block';
        status.textContent = message || 'An error occurred';
        if (metadataOutput) {
            metadataOutput.textContent = 'Failed to process file.';
        }
    }

    function showWriteSuccess(
        resultContainer: HTMLDivElement,
        status: HTMLDivElement,
        downloadContainer: HTMLDivElement
    ): void {
        resultContainer.style.display = 'block';
        status.className = 'status-message';
        status.style.display = 'block';
        status.textContent = 'Metadata written successfully!';
        downloadContainer.style.display = 'block';
    }

    function copyToClipboard(metadataOutput: HTMLPreElement, copyBtn: HTMLButtonElement): void {
        navigator.clipboard.writeText(metadataOutput.textContent || '')
            .then(() => {
                const _originalText = copyBtn.textContent;
                copyBtn.textContent = 'Copied!';
                setTimeout(() => {
                    copyBtn.textContent = 'Copy';
                }, 2000);
            });
    }

    function downloadJSON(metadataOutput: HTMLPreElement, currentFile: File | null): void {
        if (!currentFile) return;
        
        const blob = new Blob([metadataOutput.textContent || ''], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentFile.name}-metadata.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
});