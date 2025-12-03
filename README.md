# @uswriting/exiftool

[ExifTool](https://exiftool.org) (13.42) powered by WebAssembly to extract and write metadata from files in browsers and Node.js environments using [zeroperl](https://github.com/uswriting/zeroperl).

## Installation

```
npm install @uswriting/exiftool
```

## Description

This package provides a WebAssembly-based implementation of ExifTool that works in both browser and Node.js environments. It leverages [zeroperl](https://github.com/uswriting/zeroperl) to execute ExifTool without requiring any native binaries or system dependencies.

## Usage

### Basic Usage

```typescript
import { parseMetadata } from '@uswriting/exiftool';

// Browser usage with File API
document.querySelector('input[type="file"]').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  const result = await parseMetadata(file);
  
  if (result.success) {
    console.log(result.data);
  } else {
    console.error('Error:', result.error);
  }
});
```

### Writing Metadata

```typescript
import { writeMetadata } from '@uswriting/exiftool';

const result = await writeMetadata(file, {
  'Author': 'John Doe',
  'Title': 'My Photo',
  'Keywords': 'nature,photography'
});

if (result.success) {
  // result.data contains the modified file as Uint8Array
  const modifiedBlob = new Blob([result.data]);
}
```

### Extracting Specific Metadata

```typescript
import { parseMetadata } from '@uswriting/exiftool';

const result = await parseMetadata(file, {
  args: ['-Author', '-CreateDate', '-Make', '-Model']
});

if (result.success) {
  console.log(result.data);
}
```

### JSON Output

```typescript
import { parseMetadata } from '@uswriting/exiftool';

const result = await parseMetadata(file, {
  args: ['-json', '-n'],
  transform: (data) => JSON.parse(data)
});

if (result.success) {
  // Typed access to properties
  console.log(result.data); // { ... }
}
```

## Important Notes

- In browser environments, pass the `File` object directly from file inputs. Do not convert it to an ArrayBuffer or Uint8Array.
- This package uses asynchronous web APIs for file processing which allows handling files over 2GB without loading them entirely into memory.
- ExifTool is executed entirely within the browser or Node.js environment - no server requests are made for metadata extraction.

## API Reference

### parseMetadata()

```typescript
async function parseMetadata<TReturn = string>(
  file: Binaryfile | File,
  options: ExifToolOptions<TReturn> = {}
): Promise<ExifToolOutput<TReturn>>
```

#### Parameters

- `file`: Either a browser `File` object or a `Binaryfile` object with `name` and `data` properties.
- `options`: Configuration options for the metadata extraction.

### writeMetadata()

```typescript
async function writeMetadata(
  file: Binaryfile | File,
  tags: ExifTags,
  options: ExifToolOptions = {}
): Promise<ExifToolOutput<ArrayBuffer>>
```

#### Parameters

- `file`: Either a browser `File` object or a `Binaryfile` object with `name` and `data` properties.
- `tags`: Object containing metadata tags to write, where keys are tag names and values are tag values.
- `options`: Configuration options for the write operation.

#### Return Value

Returns a Promise that resolves to an `ExifToolOutput` object:

```typescript
type ExifToolOutput<TOutput> =
  | {
      success: true;
      data: TOutput;
      error: string;
      exitCode: 0;
    }
  | {
      success: false;
      data: undefined;
      error: string;
      exitCode: number | undefined;
    };
```

## License

Apache License, Version 2.0