const sidebarResize = document.querySelector('.sidebar-resize');
const sidebar = document.querySelector('.sidebar');
const collectionsResize = document.querySelector('.collections-resize');
const collections = document.querySelector('.collections');
let isResizing = false;

sidebarResize.addEventListener('mousedown', (e) => {
    isResizing = true;
    const initialX = e.clientX;

    document.addEventListener('mousemove', resizeSidebar);
    document.addEventListener('mouseup', stopResize);

    function resizeSidebar(e) {
        if (isResizing) {
            const width = initialX - e.clientX;
            const sidebarWidth = sidebar.offsetWidth;
            const newWidth = sidebarWidth + width;
            // const newWidth = width;
            
            sidebar.style.width = `${newWidth}px`;
            // viewport.style.width = `calc(100% - ${newWidth}px)`;
        }
    }

    function stopResize() {
        isResizing = false;
        document.removeEventListener('mousemove', resizeSidebar);
        document.removeEventListener('mouseup', stopResize);
    }
});
collectionsResize.addEventListener('mousedown', (e) => {
  isResizing = true;
  const initialY = e.clientY;

  document.addEventListener('mousemove', resizeCollections);
  document.addEventListener('mouseup', stopResize);

  function resizeCollections(e) {
      if (isResizing) {
          const height = initialY - e.clientY;
          const collectionsHeight = sidebar.offsetHeight;
          const newHeight = height;
          
          collections.style.height = `${e.clientY}px`;
          // viewport.style.width = `calc(100% - ${newWidth}px)`;
      }
  }

  function stopResize() {
      isResizing = false;
      document.removeEventListener('mousemove', resizeCollections);
      document.removeEventListener('mouseup', stopResize);
  }
});
