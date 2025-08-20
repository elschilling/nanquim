# Nanquim

**A lightweight 2D CAD tool for the web, built on SVG.**

[Live Demo](https://nanquim.vercel.app/) | [GitHub](https://github.com/elschilling/nanquim)

---

Nanquim is a simple, browser-based 2D CAD editor designed for creating technical drawings directly in SVG. The goal is to provide a straightforward and accessible tool for precision drawing without the need for heavy desktop software.

The name "Nanquim" is a nod to the ink pens (canetas nanquim) traditionally used by architects and engineers for creating detailed technical drawings. This project aims to bring that same spirit of precision and craft to the modern web.

## The Vision

My dream would be to see this kind of editor inside Blender one day. For now, I’m just rolling with what I know—HTML/CSS/JS—before even thinking about how it could fit into Blender. I'm curious, does anyone else feel like we’re missing a good 2D tool for making technical drawings natively in SVG?

## Features

Nanquim is still in early development, but it already includes basic CAD functionalities:

*   **Drawing Tools:** Create lines, circles, rectangles, and more.
*   **Modification Tools:** Move, rotate, fillet, and offset elements.
*   **Viewport:** A familiar interface with pan and zoom capabilities.
*   **Outliner:** A hierarchical view of all the elements in the drawing.
*   **Properties Editor:** Inspect and modify the attributes of selected elements.
*   **File Support:** Basic support for importing `.dxf` files.

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
