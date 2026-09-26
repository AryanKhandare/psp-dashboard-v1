const spreadsheetId = '1vZUBWe2c5pNdKTQ808jF8XPeE5j-XOUYwHAsNK0aqB8';

async function run() {
  try {
    const query = "SELECT V, AO LIMIT 200";
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?sheet=FMS&tqx=out:json&tq=${encodeURIComponent(query)}`;
    
    const response = await fetch(url);
    const rawText = await response.text();
    const jsonData = rawText.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '');
    const parsed = JSON.parse(jsonData);
    
    const rows = parsed.table.rows;
    console.log("=== COL V AND AO VALUES ===");
    rows.forEach((row, rowIdx) => {
      if (rowIdx <= 4) return; // skip headers
      const valV = row.c[0] && row.c[0].v !== null ? String(row.c[0].v).trim() : null;
      const valAO = row.c[1] && row.c[1].v !== null ? String(row.c[1].v).trim() : null;
      if (valV || valAO) {
        console.log(`Row ${rowIdx}: V="${valV}" | AO="${valAO}"`);
      }
    });

  } catch (error) {
    console.error("Error:", error);
  }
}

run();
