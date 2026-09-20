/**
 * Operations Menu Manager
 * Provides a quick-access menu for common Figma design operations
 * Each operation is a pre-formatted prompt ready to copy to Claude
 */

class OperationsMenu {
  constructor() {
    this.operations = [
      {
        id: 'convert_to_grid',
        category: 'Layout',
        title: 'Convert to Grid',
        description: 'Convert selected layers to Figma Grid layout with minimal structure',
        triggers: ['convert to grid', 'make this a grid', 'gridify'],
        prompt: 'Convert this selection to a Figma Grid layout. Minimize the number of layers while keeping the design identical.',
        icon: '📊'
      },
      {
        id: 'rename_layers',
        category: 'Organization',
        title: 'Rename Layers',
        description: 'Rename layers using semantic naming conventions (BEM-like prefixes)',
        triggers: ['rename layers', 'organize layer names', 'clean up layers'],
        prompt: 'Rename all layers in this selection using professional frontend naming conventions. Use semantic HTML + BEM-like prefixes.',
        icon: '📝'
      },
      {
        id: 'make_responsive',
        category: 'Responsive',
        title: 'Make Responsive',
        description: 'Adapt the design across tablet (768px) and mobile (320px) breakpoints',
        triggers: ['make responsive', 'responsive design', 'tablet mobile'],
        prompt: 'Make this design responsive for tablet (768px) and mobile (320px). Adapt layout without redesigning the visual identity.',
        icon: '📱'
      },
      {
        id: 'optimize_layers',
        category: 'Organization',
        title: 'Optimize Layers',
        description: 'Clean up unnecessary wrappers and flatten redundant structure',
        triggers: ['optimize layers', 'clean up', 'fewer layers'],
        prompt: 'Optimize the layer structure by removing unnecessary wrappers and empty frames.',
        icon: '✨'
      },
      {
        id: 'import_html',
        category: 'Import/Export',
        title: 'Import HTML',
        description: 'Convert HTML/CSS into Figma components and styles',
        triggers: ['import html', 'convert html', 'html to figma'],
        prompt: 'Import this HTML into Figma as proper components and styles.',
        icon: '🔗'
      },
      {
        id: 'design_system_audit',
        category: 'Design System',
        title: 'Design System First',
        description: 'Inspect and reuse existing design system before creating new elements',
        triggers: ['design system', 'use existing', 'reuse components'],
        prompt: 'Before making any changes, inspect the local design system. Reuse existing components, variables, and styles before creating anything new.',
        icon: '🎨'
      },
      {
        id: 'fix_typography',
        category: 'Typography',
        title: 'Fix Typography',
        description: 'Ensure typography is bound to text styles and scales correctly',
        triggers: ['fix typography', 'text styles', 'font consistency'],
        prompt: 'Review and fix typography. Bind all text to existing text styles and ensure proper hierarchy and scaling.',
        icon: '🔤'
      },
      {
        id: 'audit_spacing',
        category: 'Layout',
        title: 'Audit Spacing',
        description: 'Review and standardize spacing, padding, and gaps using design tokens',
        triggers: ['audit spacing', 'spacing review', 'padding consistency'],
        prompt: 'Audit spacing throughout this design. Use existing design tokens for padding, gaps, and margins. Fix inconsistencies.',
        icon: '📐'
      },
      {
        id: 'hug_heights',
        category: 'Responsive',
        title: 'Apply Hug Heights',
        description: 'Replace fixed heights with Hug Contents for responsive content',
        triggers: ['hug height', 'hug contents', 'content height'],
        prompt: 'Convert fixed heights to Hug Contents for all content containers. Ensure responsive layers grow with their content.',
        icon: '📏'
      },
      {
        id: 'color_audit',
        category: 'Design System',
        title: 'Color Audit',
        description: 'Ensure all colors are bound to color variables/styles',
        triggers: ['color audit', 'color variables', 'color consistency'],
        prompt: 'Audit all colors. Bind them to existing color variables. Flag any colors not in the design system.',
        icon: '🎯'
      }
    ];

    this.filteredOperations = [...this.operations];
    this.searchQuery = '';
    this.selectedCategory = 'all';
  }

  /**
   * Get all available categories
   */
  getCategories() {
    const categories = new Set(this.operations.map(op => op.category));
    return ['all', ...Array.from(categories).sort()];
  }

  /**
   * Search and filter operations
   */
  search(query) {
    this.searchQuery = query.toLowerCase();
    this.filterOperations();
  }

  /**
   * Filter by category
   */
  setCategory(category) {
    this.selectedCategory = category;
    this.filterOperations();
  }

  /**
   * Apply current filters
   */
  filterOperations() {
    this.filteredOperations = this.operations.filter(op => {
      const matchesSearch =
        !this.searchQuery ||
        op.title.toLowerCase().includes(this.searchQuery) ||
        op.description.toLowerCase().includes(this.searchQuery) ||
        op.triggers.some(t => t.includes(this.searchQuery));

      const matchesCategory =
        this.selectedCategory === 'all' || op.category === this.selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }

  /**
   * Get formatted prompt for operation
   */
  getPrompt(operationId) {
    const op = this.operations.find(o => o.id === operationId);
    if (!op) return '';

    // Format as a clean, ready-to-use prompt for Claude
    return `${op.prompt}`;
  }

  /**
   * Get all operations
   */
  getAll() {
    return this.filteredOperations;
  }
}

// Export for use in the plugin UI
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OperationsMenu;
}
