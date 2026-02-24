const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('Batch API running'));

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running on port 3000');
});