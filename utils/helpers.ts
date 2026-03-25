/**
 * Format an array of strings into a two-column "table" text format with aligned pipes.
 * Uses padding based on the maximum length of the first column items.
 * 
 * Example:
 * 1.Akola      | 2.Amravati
 * 3.Nagpur     | 4.Pune
 */
export function formatAsTable(items: string[]): string {
    if (!items || items.length === 0) return '';
    
    const lines: string[] = [];
    const pairs: [string, string][] = [];
    
    // Group into pairs
    for (let i = 0; i < items.length; i += 2) {
        pairs.push([
            `${i + 1}.${items[i]}`,
            items[i + 1] ? `${i + 2}.${items[i + 1]}` : ''
        ]);
    }
    
    // Find max length of the first column (including index)
    const maxLen = Math.max(...pairs.map(p => p[0].length));
    
    for (const [first, second] of pairs) {
        if (second) {
            // Add padding to 'first' to align the pipe
            // Using a few extra spaces for breathing room
            const paddedFirst = first.padEnd(maxLen + 2, ' ');
            lines.push(`${paddedFirst}| ${second}`);
        } else {
            lines.push(first);
        }
    }
    
    return lines.join('\n');
}
