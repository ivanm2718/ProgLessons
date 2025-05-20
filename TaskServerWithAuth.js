// Import necessary modules
const { Pool } = require('pg');        
const express = require('express');    
const cors = require('cors');          
const bcrypt = require('bcrypt');      // For hashing passwords
const jwt = require('jsonwebtoken');   // For creating/verifying JWTs

const app = express();
const port = 3000; 

// --- Configuration ---
// Store this in dotenv in a real app! This is simplified.
const JWT_SECRET = "YOUR_SECRET_KEY_GOES_HERE"; // You can try changing this
const SALT_ROUNDS = 10; // How much processing power to use for hashing (higher = slower but more secure)

// --- Database Connection ---
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'taskmanager_db',
  password: "1234", 
  port: 5432,
});

// Test DB connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
      console.error("Database Connection Error:", err);
  } else {
      console.log('Connected to PostgreSQL at', res.rows[0].now);
  }
});

app.use(cors());          // Allow requests from other origins (like your Vue frontend)
app.use(express.json());  // Allow server to understand JSON request bodies


// --- Authentication Middleware (The "Bouncer") ---
// This function checks if a valid JWT was sent with the request
const authenticateToken = (req, res, next) => {
  // Get the token from the Authorization header (e.g., "Bearer TOKEN_STRING")
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extract the token part (Bearer -token-)

  if (token == null) {
    // No token was sent
    return res.status(401).json({ error: 'Authentication token required' }); // 401 Unauthorized
  }

  // Verify the token using the secret key
  jwt.verify(token, JWT_SECRET, (err, userPayload) => {
    if (err) {
      // Token is invalid (expired, wrong signature, no permission etc.)
      return res.status(403).json({ error: 'Invalid or expired token' }); // 403 Forbidden
    }

    // Token is valid! Attach the payload (user info) to the request object
    // Now other route handlers know who the logged-in user is
    req.user = userPayload; // Contains whatever we put in it during login (e.g., { userId: ..., username: ...})
    next(); // Allow the request to proceed to the intended route handler, so it doesn't stay hanging
  });
};


// --- Routes ---

// == Authentication Routes ==

// POST /register - Create a new user account
app.post('/register', async (req, res) => {
  const { username, password, is_admin = false } = req.body; // by default is_admin is set to false

  // Basic validation
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Check if username already exists
    const userCheck = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userCheck.rows.length > 0) {
        return res.status(409).json({ error: 'Username already taken' }); // 409 Conflict
    }

    // Hash the password using bcrypt (includes salting automatically)
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert the new user into the database
    const { rows } = await pool.query(
      'INSERT INTO users (username, password, is_admin) VALUES ($1, $2, $3) RETURNING id, username, is_admin', // Don't return the password hash!
      [username, passwordHash, is_admin]
    );

    res.status(201).json({ // 201 Created
        message: 'User registered successfully!',
        user: rows[0] // Send back some user info (excluding password hash)
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// POST /login - Log a user in
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Find the user by username
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (rows.length === 0) {
      // User not found
      return res.status(401).json({ error: 'Invalid username or password' }); // Use a generic message for security
    }

    const user = rows[0];

    // Compare the provided password with the stored hash using bcrypt
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      // Passwords don't match
      return res.status(401).json({ error: 'Invalid username or password' }); // Generic message
    }

    // --- Password is Correct - Authentication Successful! ---

    // Create a JWT payload (information to store in the token)
    // Keep payload small! Don't store sensitive info here.
    const jwtPayload = {
      userId: user.id,        // Include user ID
      username: user.username, // Include username
      is_admin: user.is_admin // Include role (admin/normal user)
    };

    // Sign the JWT using the secret key. It will expire in 1 hour.
    const token = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: '5d' }); // '1h' = 1 hour, '7d' = 7 days etc.
    // Send the token back to the client
    res.json({
        message: 'Login successful!',
        token: token // The client needs to store this token
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to log in' });
  }
});


// GET /tasks - Fetch tasks. Admins see all, regular users see only their own.
// Apply the authenticateToken middleware *before* the route handler
app.get('/tasks', authenticateToken, async (req, res) => {
    // The user ID and is_admin status are now available from the token payload
    const loggedInUserId = req.user.userId;
    // Make sure 'is_admin' matches the key you put in the JWT payload during login
    const is_admin = req.user.is_admin;
  
    try {
        let query;
        let params;
  
        // Check if the user is an admin (based on the JWT payload)
        if (is_admin === true) { // Explicitly check for true
            // Admins get all tasks, regardless of user_id
            query = 'SELECT * FROM tasks'; // Order by user then task id
            params = []; // No parameters needed for this query
        } else {
            // Regular users only get tasks matching their user_id
            query = 'SELECT * FROM tasks WHERE user_id = $1';
            params = [loggedInUserId]; // Pass the user's ID as a parameter
        }
  
        // Execute the dynamically constructed query
        const { rows } = await pool.query(query, params);
        res.json(rows); // Send back the appropriate set of tasks 
  
    } catch (err) {
        console.error('Error fetching tasks:', err);
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
  });
  
    // POST - Create a new task (POST /tasks)
  app.post('/tasks', async (req, res) => {
      const { name, completed, user_id } = req.body;
      try {
        const { rows } = await pool.query(
          'INSERT INTO tasks (name, completed, user_id) VALUES ($1, $2, $3) RETURNING *',
          [name, completed, user_id]
        );
        res.status(201).json(rows[0]);
      } catch (err) {
        res.status(500).json({ error: 'Failed to create task' });
      }
  });
  
  
  // PUT - update a task (PUT /tasks/:id)
  app.put('/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { name, completed, user_id } = req.body;
    try {
      const { rows } = await pool.query(
        'UPDATE tasks SET name = $1, completed = $2, user_id = $3 WHERE id = $4 RETURNING *',
        [name, completed, user_id, id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update task' });
    }
  });
  
  // DELETE a task by ID (DELETE /tasks/:id)
  app.delete('/tasks/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const { rows } = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }
      res.status(204).send(); // 204 = No Content
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete task' });
    }
  });
  
  // DELETE a user by ID (DELETE /users/:id)
  app.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.status(204).send(); // 204 = No Content
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });
  
  
  

// == Server Startup ==
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});