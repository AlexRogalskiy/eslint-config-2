const { basename, extname } = require('node:path');

const groupBy = require('lodash/groupBy');
const kebabCase = require('lodash/kebabCase');
const startCase = require('lodash/startCase');

/**
 * Return a string containing Storybook Docs MDX markup for a color.
 *
 * @param {object} prop - Theo property
 * @returns {string}
 */
function mdxColor(prop) {
  return `
<ColorItem
  title={'$${kebabCase(prop.name)}'}
  subtitle={${prop.comment ? `'${prop.comment}'` : null}}
  colors={['${prop.value}']}/>`.trim();
}

/**
 * Return a string containing Storybook Docs MDX markup for multiple colors.
 *
 * @param {Array} props - Theo properties
 * @returns {string}
 */
function mdxColors(props) {
  const colors = props.map(mdxColor);
  return `
<ColorPalette>
  ${colors.join('\n')}
</ColorPalette>`.trim();
}

/**
 * Return a string containing Storybook Docs MDX markup for a single row of a
 * property table.
 *
 * @param {object} prop - Theo property
 * @returns {string}
 */
function mdxProp(prop) {
  return `
<tr>
  <th scope="row">$${kebabCase(prop.name)}</th>
  <td>${prop.value}</td>
</tr>
  `.trim();
}

/**
 * Return a string containing Storybook Docs MDX markup for a property table.
 *
 * @param {Array} props - Theo properties
 * @returns {string}
 */
function mdxProps(props) {
  const rows = props.map(mdxProp);
  return `
<table>
  <thead>
    <th>Name</th>
    <th>Value</th>
  </thead>
  <tbody>${rows.join('\n')}</tbody>
</table>`.trim();
}

/**
 * Return a string containing Storybook Docs MDX markup for a single category
 * of Theo properties.
 *
 * @param {string} category - Category of Theo properties
 * @param {Array} props - Theo properties
 * @returns {string}
 */
function categoryToMdx(category, props) {
  const categoryTitle = startCase(category);
  const categoryBody = category.includes('color')
    ? mdxColors(props)
    : mdxProps(props);

  return `
## ${categoryTitle}

${categoryBody}
`.trim();
}

/**
 * Theo format for Storybook Docs (`.stories.mdx`).
 *
 * @param {ImmutableMap} result - Map of Theo properties and meta.
 * @returns {string}
 */
function mdxStoriesFormat(result) {
  const file = result.getIn(['meta', 'file']);
  const filename = basename(file);
  const slug = basename(filename, extname(filename));
  const title = startCase(slug);
  const props = result.get('props').toJS();
  const categories = groupBy(props, 'category');
  const mdxCategories = Object.keys(categories).map((category) =>
    categoryToMdx(category, categories[category])
  );
  return `
import { Meta, ColorPalette, ColorItem } from '@storybook/addon-docs/blocks';

<Meta title="Design Tokens/${title}"/>

# ${title}

\`\`\`scss
@use 'path/to/${filename}';
$example: ${slug}.$${kebabCase(props[0].name)}; // => ${props[0].value}
\`\`\`

${mdxCategories.join('\n\n')}`.trim();
}

module.exports = mdxStoriesFormat;
