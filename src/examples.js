// examples.js
// Shows read-only Blockly blocks (from AQUI) in each example's detail view,
// replacing the description panel.
//
// Sources are the local files in src/examples/Glossary. They used to be
// fetched from raw.githubusercontent.com even though identical copies sat in
// the repo, which made the Examples tab require internet access and depend on
// a third-party repository staying put.
//
// Requires window.rebuildWorkspaceFromAqui, supplied by the shell.

document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    const examples = {
      'satsuma': {
        image: './Images/satsuma.png',
        file: './src/examples/Glossary/satsuma.txt'
      },
      'crab': {
        image: './Images/crab.png',
        file: './src/examples/Glossary/crab.txt'
      },
      'swordfish': {
        image: './Images/swordfish.png',
        file: './src/examples/Glossary/swordfish.txt'
      },
      'starfish': {
        image: './Images/starfish.png',
        file: './src/examples/Glossary/starfish.txt'
      },
      'seafish': {
        image: './Images/seafish.png',
        file: './src/examples/Glossary/seafish.txt'
      },
      'finger-joint-box': {
        image: './Images/finger-joint-box.png',
        file: './src/examples/Glossary/finger-joint-box.txt'
      },
      'puzzle-tiles-grid': {
        image: './Images/puzzle-tiles-grid.png',
        file: './src/examples/Glossary/puzzle_tiles_grid.txt'
      },
      'mini-desk-organizer': {
        image: './Images/mini-desk-organizer.png',
        file: './src/examples/Glossary/mini_desk_organizer.txt'
      },
      'ruler': {
        image: './Images/ruler.png',
        file: './src/examples/Glossary/ruler.txt'
      },
      'cnc-safety-checklist': {
        image: './Images/cnc-safety-checklist.png',
        file: './src/examples/Glossary/cnc_safety.txt'
      },
      'shelf-system': {
        image: './Images/shelf-system.png',
        file: './src/examples/Glossary/shelf_system.txt'
      },
      'chair': {
        image: './Images/chair.png',
        file: './src/examples/Glossary/chair.txt'
      },
      'parametric-construction-kit': {
        image: './Images/parametric-construction-kit.png',
        file: './src/examples/Glossary/parametric_construction_kit.txt'
      },
      'fish': {
        image: './Images/fish.png',
        file: './src/examples/Glossary/fish.txt'
      }
    };

    const cards       = document.querySelectorAll('.example-card');
    const menu        = document.querySelector('.examples-section');
    const detail      = document.querySelector('.example-detail');
    const detailImage = detail.querySelector('.detail-image');
    const detailCode  = detail.querySelector('.detail-code');
    const detailInfo  = detail.querySelector('.detail-info'); // we'll repurpose this as the blocks container
    const backBtn     = detail.querySelector('.detail-back');

    let currentWorkspace = null;

    function disposeCurrentWorkspace() {
      try {
        if (currentWorkspace && typeof currentWorkspace.dispose === 'function') {
          currentWorkspace.dispose();
        }
      } catch (e) {
        console.warn('Failed to dispose workspace:', e);
      } finally {
        currentWorkspace = null;
      }
    }

    function createReadOnlyBlockly(container) {
      // Read-only viewer with zoom + scrollbars (no drag editing)
      const ws = Blockly.inject(container, {
        readOnly: true,
        toolbox: null,
        trashcan: false,
        zoom: { controls: true, wheel: true, startScale: 0.9, maxScale: 3, minScale: 0.2 },
        move: { scrollbars: true, drag: true, wheel: true },
        grid: { spacing: 20, length: 3, colour: '#eee', snap: false },
        renderer: 'thrasos',
        disableContextMenu: true
      });
      container.__workspace = ws;
      return ws;
    }

    function showHint(container, text) {
      const hint = document.createElement('div');
      hint.style.padding = '12px';
      hint.style.fontFamily = 'monospace';
      hint.style.fontSize = '12px';
      hint.textContent = text;
      container.appendChild(hint);
    }

    // The shell's rebuildWorkspaceFromAqui reports a failed parse by returning
    // false rather than throwing, so a bare try/catch would leave the viewer
    // showing an empty grid with no explanation.
    function renderAquiToWorkspace(aquiText, ws) {
      if (typeof window.rebuildWorkspaceFromAqui !== 'function') {
        console.error('rebuildWorkspaceFromAqui is not available on window; the shell should have installed it.');
        return false;
      }
      try {
        if (window.rebuildWorkspaceFromAqui(aquiText, ws) === false) {
          console.error('AQUI → Blocks render failed: source did not parse.');
          return false;
        }
        if (typeof ws.zoomToFit === 'function') ws.zoomToFit();
        Blockly.svgResize(ws);
        return true;
      } catch (e) {
        console.error('AQUI → Blocks render failed:', e);
        return false;
      }
    }

    async function loadAquiText(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const text = await response.text();
      if (text.includes('<!DOCTYPE html>')) {
        throw new Error('File not found - received HTML instead');
      }
      return text;
    }

    cards.forEach(card => {
      card.addEventListener('click', async () => {
        const key = card.dataset.example;
        const ex  = examples[key];

        // Clear any existing titles and content
        detail.innerHTML = `
          <button class="detail-back">Back</button>
          <img class="detail-image" src="" alt="Example Code" />
          <div class="detail-panels">
            <pre class="detail-code"></pre>
            <div class="detail-info"></div>
          </div>
        `;
        
        // Re-select elements after clearing
        const detailImage = detail.querySelector('.detail-image');
        const detailCode = detail.querySelector('.detail-code');
        const detailInfo = detail.querySelector('.detail-info');
        const backBtn = detail.querySelector('.detail-back');

        // Image
        detailImage.src = ex.image;

        // Fetch AQUI
        let aquiText = '';
        try {
          aquiText = await loadAquiText(ex.file);
          detailCode.textContent = aquiText; // keep raw AQUI visible
        } catch (error) {
          const msg = `// Error loading .aqui file: ${error.message}\n// File path: ${ex.file}`;
          detailCode.textContent = msg;
          console.error('Fetch error:', error);
        }

        // Reset + create blocks container
        disposeCurrentWorkspace();
        detailInfo.innerHTML = `
          <div class="example-blockly-viewer" style="
            width:100%;
            height:460px;
            border:1px solid #e5e7eb;
            border-radius:8px;
            background:#fafafa;
            overflow:hidden;
          "></div>
        `;
        const container = detailInfo.querySelector('.example-blockly-viewer');

        // Create read-only workspace + render AQUI → Blocks
        currentWorkspace = createReadOnlyBlockly(container);
        // If the load failed, or the source did not render, still show an
        // empty workspace with a hint rather than a blank panel.
        if (!aquiText || !renderAquiToWorkspace(aquiText, currentWorkspace)) {
          showHint(container, 'Unable to load blocks.');
        }

        // Toggle views - hide menu, show detail
        menu.style.display = 'none';
        detail.classList.add('visible');
        
        // Re-attach back button event listener
        backBtn.addEventListener('click', () => {
          detail.classList.remove('visible');
          menu.style.display = '';
          disposeCurrentWorkspace();
          detailInfo.innerHTML = ''; // clear viewer
        });
      });
    });

    // Keep viewer layout crisp on resize
    window.addEventListener('resize', () => {
      const ws = currentWorkspace;
      if (ws) Blockly.svgResize(ws);
    });
  })();
});

