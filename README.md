# Nanquim

**A lightweight 2D CAD tool for the web, built on SVG.**

[Live Demo](https://nanquim.vercel.app/) | [GitHub](https://github.com/elschilling/nanquim)

---

Nanquim is a simple, browser-based 2D CAD editor designed for creating technical drawings directly in SVG. The goal is to provide a straightforward and accessible tool for precision drawing without the need for heavy desktop software.

The name "Nanquim" is a nod to the ink pens (canetas nanquim) traditionally used by architects and engineers for creating detailed technical drawings. This project aims to bring that same spirit of precision and craft to the modern web.

## The Vision

My dream would be to see this kind of editor inside Blender one day. For now, I’m just rolling with what I know—HTML/CSS/JS—before even thinking about how it could fit into Blender. I'm curious, does anyone else feel like we’re missing a good 2D tool for making technical drawings natively in SVG?

## Features

Nanquim is in active development but already sports a robust set of 2D CAD features:

### 🛠️ Drawing & Modification Commands
*   **Draw**: Line (`L`), Circle (`C`), Rectangle (`REC`), Arc (`A`)
*   **Modify**: Move (`M`), Copy (`CO`), Rotate (`R`), Scale (`S`), Offset (`O`), Fillet (`F`), Mirror (`MI`)
*   **Edit**: Trim (`TR`), Extend (`EX`), Erase (`E`)
*   **Utilities**: Measure Distance (`D`), Match Properties (`MA`)

### 📦 Layers & Organization
*   **Collections System**: Group elements into manageable, hierarchical collections (layers).
*   **Outliner**: A Photoshop/Blender-style hierarchical tree view to easily select, hide (`eye icon`), or lock (`padlock icon`) elements and collections.
*   **Properties Panel**: Inspect and tweak attributes (color, stroke width, collection assignment) of selected elements.

### 📐 Precision & Workflow
*   **Snapping**: `OSNAP` (endpoints, midpoints, intersections) and `ORTHO` (orthogonal locking) modes for precise drawing.
*   **Viewport**: Infinite canvas with smooth pan (`Middle Mouse`) and zoom (`Scroll`) capabilities.
*   **Command Line Interface**: AutoCAD-style command aliases for fast, keyboard-driven workflows.

### 💾 File Support
*   **Import**: Load existing `.dxf` (CAD files) or `.svg` drawings.
*   **Export**: Save your drawings natively to standalone, standard `.svg` files (with smart white-to-black stroke conversion for external viewing).

## Tech Stack

*   **Frontend:** HTML, SASS, and vanilla JavaScript
*   **Templating:** Pug
*   **Build Tool:** Vite

## Getting Started

To run Nanquim locally:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/elschilling/nanquim.git
    cd nanquim
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Start the development server:**
    ```bash
    npm run dev
    ```

This will open the application in your default browser.

## Contributing

This is a personal project born out of a desire for a better 2D drawing tool on the web. Contributions, ideas, and feedback are highly welcome! Feel free to open an issue or submit a pull request.

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.
