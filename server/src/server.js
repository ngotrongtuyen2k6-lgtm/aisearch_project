const path = require('node:path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = require('./app');
const port = Number(process.env.PORT) || 3001;

app.listen(port, () => {
  console.log(`Verity API listening on http://localhost:${port}`);
});
