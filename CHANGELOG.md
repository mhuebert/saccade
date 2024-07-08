# Change Log

All notable changes to the "saccade" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added

### Changed

### Fixed

## [0.1.8] - 2024-07-08

### Fixed

- Fixed explicit cell detection

## [0.1.7] - 2024-07-08

### Added

- New `UseExplicitCellsIfPresent` option (default: false) controls whether to use `# %%` markers if found in the doc.

## [0.1.6] - 2024-07-08

### Fixed

- Release script fix

## [0.1.5] - 2024-07-08

### Added

- New `Evaluate Cell and Above` command

### Changed

- Use 'cell' consistenty (instead of 'block' or 'toplevel form')
- Use `saccade.accentColor` theme color instead of configuration value

## [0.1.4] - 2024-07-05

### Changed

- Do not show current cell border by default

### Fixed

- Do not run extension when the python interactive window input is active

## [0.1.3] - 2024-07-05

### Added

- Show border above/below the current cell
- Use incremental parsing
- Allow configuration: debug logging, decorations
- Scroll next cell into view

## [0.1.2] - 2024-07-01

### Fixed

- Improved cell detection
- Tests passing

## [0.1.1] - 2024-06-30

### Added
- Initial release of Saccade extension with core functionalities:
  - Cell detection (explicit and implicit)
  - Code execution in Jupyter
  - Visual feedback (cell highlighting and flash effect)
  - Navigation between cells
- Basic error handling and user feedback
- Configuration options for cell markers
- Initial test suite

