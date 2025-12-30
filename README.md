<p align="center">
  <img src="/examples/Heading.png" width="40%">
</p>

# EPUB BookPrep
EPUB BookPrep is a selfhosted, privacy-first, stateless web tool for preparing clean, standards-compliant EPUB metadata. Upload a file, make precise edits, and download a corrected EPUB, no accounts, no background processing, and no files stored on the server.

*The project is inspired by [BentoPDF](https://github.com/mgmeyers/bentopdf) in both philosophy and workflow.*

<p>
  <img src="https://img.shields.io/github/stars/gjessing1/epub-bookprep?style=social" alt="GitHub stars">
  <a href="https://buymeacoffee.com/gjessing">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" width="80" style="vertical-align: middle;">
  </a>
</p>


## Features
- Inspect and edit common EPUB metadata fields  
  (title, author, language, publisher, series, identifiers, description)
- Fetch metadata from public sources using ISBN or title-based search
- Review and selectively apply fetched metadata to avoid incorrect matches
- Search for available cover images, preview alternatives, and explicitly choose whether to replace or keep the existing cover
- Clean and normalize metadata:
  - trim whitespace
  - normalize date formats
  - strip HTML from descriptions
  - deduplicate subjects
- Preview how metadata will appear in OPDS-based clients before importing into a library or reader
- Light and dark mode support

## Screenshots
<p align="center">
  <img src="/examples/Drop%20field.jpg" alt="Desktop view" width="40%">
  <img src="/examples/Drop%20field.jpg" alt="Mobile view" width="30%">
</p>

## Key principles
- Uploaded files are processed entirely in memory and are never stored on disk. Once a request completes, no files or metadata remain on the server.
- The app only modifies EPUB metadata (OPF and related fields). Book content, structure, and reading experience are left untouched.
- The tool avoids deep EPUB “repair” or content manipulation to ensure results are easy to understand and trust.
- Only EPUB files are supported. Other ebook formats are intentionally out of scope.
- The application runs out of the box with no required configuration or environment variables.

## What this tool is not
Not an ebook library manager
Not a reader application
Not a full EPUB editor or authoring tool
Not a replacement for Calibre or Sigil

## Typical use case
Upload an EPUB file
- Inspect and adjust metadata (title, author, language, series, cover, etc.)
- Optionally enrich metadata from public sources
- Download a cleaned EPUB
- Import the result into your library or reader of choice

## Deployment

The application is distributed as a Docker container and can be run either behind a reverse proxy or directly via a mapped port. No volumes are required, as uploaded files are processed entirely in memory and never persisted.

- Download the example compose file: [`docker-compose.yml`](/examples/docker-compose.yml)
- Start the service from the same directory:
  ```bash
  docker compose up -d
- The application listens on port 3007 by default.
- Access it via http://localhost:3007, or expose it through a reverse proxy such as Caddy, Traefik, or Nginx




