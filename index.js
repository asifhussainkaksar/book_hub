import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import pg from "pg";
import session from "express-session";
import multer from "multer";
import path from "path";
import { fileURLToPath } from 'url'; 
import http from "http";
import { Server } from "socket.io";
import fs from "fs"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const app = express();
const port = 9000;
const server = http.createServer(app);
const io = new Server(server);
const userSocketMap = {};



const upload = multer({ dest: 'uploads/' });


app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
//app.use('/socket.io', express.static(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist')));

app.use(session({
    secret: 'secret', // Change this to a more secure random string in production
    resave: false,
    saveUninitialized: true
}));


const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});
db.connect()
.then(() => console.log("Connected to the database"))
.catch(err => console.error("Connection error", err.stack)); 



/*const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "book_hub",
    password: "Qwert..",
    port: 5432,
 });

 db.connect();
 */



io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    
    
    socket.on('register-user', (user_id) => {
        userSocketMap[user_id] = socket.id;
        console.log(`User ${user_id} is connected with socket ID: ${socket.id}`);
    });

    socket.on('user-message', async ({ message, recipient_id, sender_id }) => {
        const recipientSocketId = userSocketMap[recipient_id];
        const senderSocketId = userSocketMap[sender_id];
        
        await db.query("insert into messages (sender_id, receiver_id, message) values ($1, $2, $3)",[sender_id, recipient_id, message]);
        
        io.to(senderSocketId).emit("message", {message, sender_id});
        if (recipientSocketId) {
            io.to(recipientSocketId).emit("message", {message, sender_id});
            console.log(`Message sent to user ${recipient_id}:`, message);
        } else {
            console.log(`User with ID ${recipient_id} is not connected.`);
        }
    });

    /*socket.on('disconnect', () => {
        // Remove user from the map on disconnect
        for (const user_id in userSocketMap) {
            if (userSocketMap[user_id] === socket.id) {
                delete userSocketMap[user_id];
                console.log(`User ${user_id} disconnected`);
                break;
            }
        }
    });*/

});














const requireLogin = (req, res, next) => {
    if (req.session.user_id) {
        next(); // User is authenticated, proceed to the next middleware
    } else {
        res.redirect("/"); // Redirect to login page if not authenticated
    }
};





app.get("/", (req,res) =>{
    res.render("login.ejs");
});



app.get("/sign_up", (req,res)=>{
    res.render("sign_up.ejs");
})



app.post("/sign_up", async (req,res) =>{
    var username = req.body.username;
    var email = req.body.email;
    var password = req.body.password;
    var cpassword = req.body.confirm_password;
    if(password!=cpassword){
        res.render("sign_up.ejs",{err:"password and confirm password does not match"});
    }
    else{
        var response = await db.query("select * from users where email = $1",[email]);
        var result = response.rows;
        if(result.length>0){
            res.send("user already exist");
        }
        else{
            await db.query("insert into users (email, password, user_name) values ($1, $2, $3)",[email, password, username]);
            res.render("login.ejs");
        }
    }  
});



app.post("/login", async (req,res) =>{
    var email = req.body.email;
    var password=req.body.password;
    
    var response = await db.query("select * from users where email=$1 and password=$2",[email, password]);
    var result = response.rows;
    if(result.length>0){
        req.session.user_id = result[0].user_id;
        res.redirect("/main");
    }
    else{
        res.send("email or password is incorrect");
    }
});



app.get("/log_out", (req,res)=>{
    req.session.user_id=0;
    res.redirect("/");
});



var sort_option="recency";
app.post("/sort/:id", requireLogin, (req, res) =>{
    var x=req.params.id;
    sort_option = req.body.sortOptions;
    //console.log(sort_option);
    if(x==req.session.user_id){ 
        res.redirect("/main");
    }
    else{
        res.redirect("/main/"+x);
    }
});



app.get("/main",requireLogin, async (req,res) =>{
    var user_id = req.session.user_id;
    //console.log(user_id);
    
    if(sort_option=="recency"){ 
    var z = await db.query(`
        SELECT b.isbn, b.title, b.book_id, b.author, b.cover, r.review, r.rating, user_books.entry_date
        FROM books b 
        JOIN (SELECT br.book_id, br.entry_date FROM books_read br WHERE br.user_id = $1) AS user_books 
        ON b.book_id = user_books.book_id 
        LEFT JOIN reviews r 
        ON b.book_id = r.book_id AND r.user_id = $1 order by user_books.entry_date DESC
        `, [user_id]);
    }

    else if(sort_option=="rating"){
        var z = await db.query(`
            SELECT b.isbn, b.title, b.book_id, b.author, b.cover, r.review, r.rating, user_books.entry_date
            FROM books b 
            JOIN (SELECT br.book_id, br.entry_date FROM books_read br WHERE br.user_id = $1) AS user_books 
            ON b.book_id = user_books.book_id 
            LEFT JOIN reviews r 
            ON b.book_id = r.book_id AND r.user_id = $1 order by r.rating DESC
            `, [user_id]);
    }
    else{
        var z = await db.query(`
            SELECT b.isbn, b.title, b.book_id, b.author, b.cover, r.review, r.rating, user_books.entry_date
            FROM books b 
            JOIN (SELECT br.book_id, br.entry_date FROM books_read br WHERE br.user_id = $1) AS user_books 
            ON b.book_id = user_books.book_id 
            LEFT JOIN reviews r 
            ON b.book_id = r.book_id AND r.user_id = $1 order by b.title ASC
          `, [user_id]);
    }

    var result = z.rows;
    //console.log(result);

    var r=1;
    
    var x = await db.query("select * from users where user_id = $1",[user_id]);
    var y=x.rows[0].user_name;

    var photo = x.rows[0].photo;
    var r=1;
    //console.log("main "+photo);

    res.render("home.ejs", {user_id : user_id, data: result, user_name : y, photo : photo, r:r});
});




app.get("/main/:id", requireLogin, async (req,res) =>{
    var user_id=req.params.id;
    
    if(sort_option=="recency"){ 
        var z = await db.query(`
            SELECT b.isbn, b.title, b.book_id, b.author, b.cover, r.review, r.rating, user_books.entry_date
            FROM books b 
            JOIN (SELECT br.book_id, br.entry_date FROM books_read br WHERE br.user_id = $1) AS user_books 
            ON b.book_id = user_books.book_id 
            LEFT JOIN reviews r 
            ON b.book_id = r.book_id AND r.user_id = $1 order by user_books.entry_date DESC
          `, [user_id]);
        }
    
        else if(sort_option=="rating"){
            var z = await db.query(`
                SELECT b.isbn, b.title, b.book_id, b.author, b.cover, r.review, r.rating, user_books.entry_date
                FROM books b 
                JOIN (SELECT br.book_id, br.entry_date FROM books_read br WHERE br.user_id = $1) AS user_books 
                ON b.book_id = user_books.book_id 
                LEFT JOIN reviews r 
                ON b.book_id = r.book_id AND r.user_id = $1 order by r.rating DESC
              `, [user_id]);
        }
        else{
            var z = await db.query(`
                SELECT b.isbn, b.title, b.book_id, b.author, b.cover, r.review, r.rating, user_books.entry_date
                FROM books b 
                JOIN (SELECT br.book_id, br.entry_date FROM books_read br WHERE br.user_id = $1) AS user_books 
                ON b.book_id = user_books.book_id 
                LEFT JOIN reviews r 
                ON b.book_id = r.book_id AND r.user_id = $1 order by b.title DESC
              `, [user_id]);
        }
    

    var result = z.rows;
    //console.log(result);
    
    var x = await db.query("select * from users where user_id = $1",[user_id]);
    var y=x.rows[0].user_name;
    var photo = x.rows[0].photo;
    var r=0;
    //console.log("mani/:id "+photo);
    res.render("home.ejs", {user_id : user_id, data: result, user_name : y, photo : photo, r:r});
});




app.get("/add_book", requireLogin, (req,res) =>{
    //console.log(user_id);
    //res.send("hello");
    res.render("add_book_search.ejs");
});

app.get("/add_review/:id/:id1/:id2/:id3", requireLogin, (req,res) =>{
    var isbn = req.params.id;
    var title=decodeURIComponent(req.params.id1);
    var author=decodeURIComponent(req.params.id2);
    var cover=decodeURIComponent(req.params.id3);
    res.render("add_review.ejs",{isbn : isbn, title: title, author: author, cover: cover});
})





app.post("/submit_book/:id/:id1/:id2/:id3", requireLogin, async (req, res) => {
    var user_id = req.session.user_id;
    var isbn = req.params.id;
    var review = req.body.review;
    var rating = req.body.rating;
    var book_id;
    var title=decodeURIComponent(req.params.id1);
    var author=decodeURIComponent(req.params.id2);
    var cover=decodeURIComponent(req.params.id3);

        // Check if the book already exists in your database
        var dbBook = await db.query("SELECT * FROM books WHERE isbn = $1", [isbn]);
        var dbBookRows = dbBook.rows;

        if (dbBookRows.length <= 0) {
            // Book not found in the database, fetch details from Google Books API

            // Insert book details including cover into the database
            await db.query("INSERT INTO books (title, author, isbn, cover) VALUES ($1, $2, $3, $4)", [title, author, isbn, cover]);
            }
            else{
                res.render("search.ejs",{err : "book not found"});
            }

        var x = await db.query("select* from books where isbn = $1",[isbn]);
        var y = x.rows;
        book_id = y[0].book_id;

        // Check if the book is already in the user's library
        var userBook = await db.query("SELECT * FROM books_read WHERE book_id = $1 AND user_id = $2", [book_id, user_id]);
        var userBookRows = userBook.rows;

        if (userBookRows.length <= 0) {
            // Book not in user's library, insert into books_read and reviews tables
            await db.query("INSERT INTO books_read (user_id, book_id) VALUES ($1, $2)", [user_id, book_id]);
            await db.query("INSERT INTO reviews (review, rating, user_id, book_id) VALUES ($1, $2, $3, $4)", [review, rating, user_id, book_id]);
            res.redirect("/main");
        } else {
            // Book already in user's library
            res.render("search.ejs", { err: "Book already exists in your library" });
        }
    
});





app.get("/book/:id1/:id2", requireLogin, async (req,res) =>{
    var user_id = req.params.id1;
    var book_id = req.params.id2;
    
    var z = await db.query(`
        SELECT b.isbn, b.title, b.book_id, b.author, b.cover, r.review, r.rating, user_books.entry_date
        FROM books b 
        JOIN (SELECT br.book_id, br.entry_date FROM books_read br WHERE br.user_id = $1 and br.book_id=$2) AS user_books 
        ON b.book_id = user_books.book_id 
        LEFT JOIN reviews r 
        ON b.book_id = r.book_id AND r.user_id = $1
      `, [user_id,book_id]);

    var result = z.rows[0];
    //console.log(result);

    var e = await db.query("select * from notes where user_id=$1 and book_id=$2",[user_id, book_id]);
    var f=e.rows;
    var notes;
    if(f.length>0){
        notes=f;
    }
    else{
        notes="";
    }
    //console.log(notes);
    
    var r;
    if(user_id==req.session.user_id){
        r=1;
    }
    else{
        r=0;
    }
    //res.send("hello");
    res.render("book.ejs",{user_id: user_id, data: result, notes: notes, r: r});
    //res.send("hello");
});



app.get("/delete_book/:id1/:id2", requireLogin, async (req,res) =>{
    var user_id = req.params.id1;
    var book_id = req.params.id2;
    //return res.send("hello");
    await db.query("delete from reviews where book_id=$1 and user_id=$2",[book_id, user_id]);
    await db.query("delete from books_read where book_id=$1 and user_id=$2", [book_id, user_id]);
    await db.query("delete from notes where user_id = $1 and book_id = $2",[user_id, book_id]);
    res.redirect("/main");
});



app.get("/edit_review/:id1/:id2", requireLogin, async(req, res) =>{
    var user_id = req.params.id1;
    var book_id = req.params.id2;
    
    var z = await db.query("select * from reviews where user_id = $1 and book_id = $2",[user_id, book_id]);
    var result = z.rows;

     var data ={
        user_id : user_id,
        book_id : book_id,
        review : result[0].review,
        rating : result[0].rating
    }
    res.render("edit_review.ejs", {data: data});
});



app.post("/submit_review/:id1/:id2", requireLogin, async (req,res) =>{
    var user_id = req.params.id1;
    var book_id = req.params.id2;
    var review = req.body.review;
    var rating = req.body.rating;

    await db.query("update reviews set review = $1, rating = $2 where user_id = $3 and book_id = $4",[review, rating, user_id, book_id]);
    res.redirect("/book/"+user_id+"/"+book_id);
});



app.get("/add_notes/:id1/:id2", requireLogin, (req,res) =>{
    var user_id = req.params.id1;
    var book_id = req.params.id2;
    res.render("add_notes.ejs",{user_id: user_id, book_id: book_id});
});


app.post("/submit_notes/:id1/:id2", requireLogin, async (req,res) =>{
    var user_id = req.params.id1;
    var book_id = req.params.id2;
    var note = req.body.note;
    
    await db.query("insert into notes (user_id, book_id, note) values($1,$2,$3)",[user_id, book_id, note]);
    res.redirect("/book/"+user_id+"/"+book_id);
});



app.get("/other_users", requireLogin, async (req,res) =>{
    var x = await db.query("select * from users where user_id!=$1",[req.session.user_id]);
    var result=x.rows;
    //console.log(result);
    res.render("users.ejs",{data : result});
})



app.get("/search", requireLogin, async(req,res) =>{
    var r=1;
    res.render("search.ejs", {r: r});
})




app.post("/search", requireLogin, async (req, res) => {
    var query = encodeURIComponent(req.body.query);
    var apiUrl = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=20&key=AIzaSyCugJwMzeA2MGq-PLqMncetvulbxubXbfE`;

    try {
        var response = await axios.get(apiUrl);
        var books = response.data.items;
        var topBooks = books
            .filter(book => book.volumeInfo.imageLinks && book.volumeInfo.imageLinks.thumbnail) // Filter out books without a cover
            .map(book => ({
                title: book.volumeInfo.title,
                author: book.volumeInfo.authors ? book.volumeInfo.authors.join(', ') : 'Unknown',
                isbn: book.volumeInfo.industryIdentifiers ? book.volumeInfo.industryIdentifiers[0].identifier : 'ISBN not available',
                cover: book.volumeInfo.imageLinks.thumbnail
            }));

        res.render("search.ejs", { books: topBooks, r: 1 });
    } catch (error) {
        //console.error(error);
        res.render("search.ejs", { books: [], r: 1 });
    }
});



app.post("/search_database",requireLogin, async (req, res) =>{
    var query = req.body.query;
    var user_id = req.session.user_id;
    var searchQuery = `%${query}%`;
    
    var z = await db.query(`
        SELECT books.book_id, books.isbn, books.author, books.title, books.cover, books_read.user_id 
        FROM books
        JOIN books_read ON books.book_id = books_read.book_id
        WHERE books_read.user_id = $1
        AND (books.title ILIKE $2 OR books.author ILIKE $2)
    `, [user_id, searchQuery]);
      
        var result = z.rows;
        //console.log(result);

    res.render("search.ejs", {data : result});
});




app.post('/upload', upload.single('profilePhoto'), requireLogin, async (req, res) => {
    const userId = req.body.userId; // Assuming the user ID is sent in the request body
    const profilePhoto = req.file.path;
  
    /*try {
      const result = await db.query(
        'UPDATE users SET photo = $1 WHERE user_id = $2',
        [profilePhoto, userId]
      );
      res.redirect("/main");
    } catch (err) {
      console.error(err);
      res.status(500).send('Error uploading photo');
    }*/
    
    try {
        // Read the image as binary data (Buffer)
        const profilePhotoBinary = fs.readFileSync(profilePhoto);
        
        // Store the binary data in PostgreSQL
        const result = await db.query(
            'UPDATE users SET photob = $1 WHERE user_id = $2',
            [profilePhotoBinary, userId]
        );
        
        // Redirect after successful upload
        res.redirect("/main");
    } catch (err) {
        console.error(err);
        res.status(500).send('Error uploading photo');
    }

  });




  app.get('/image/:userId', async (req, res) => {
    const userId = req.params.userId;
  
    try {
        // Query the image data from PostgreSQL
        const result = await db.query('SELECT photob FROM users WHERE user_id = $1', [userId]);

        if (result.rows.length > 0) {
            const imageData = result.rows[0].photob;

            // Set content type to image (Assuming it's a PNG/JPG, you can adjust based on actual type)
            res.set('Content-Type', 'image/jpeg'); // or 'image/png' based on your actual image format

            // Send the binary image data
            res.send(imageData);
        } else {
            res.status(404).send('Image not found');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Error retrieving image');
    }
});







app.get("/message", requireLogin, async (req, res) =>{
    var x = await db.query("select * from users where user_id!=$1",[req.session.user_id]);
    var result=x.rows;
    //console.log(result);
    res.render("message_users.ejs",{data : result});
});


app.get("/message/:id", requireLogin, async (req, res) =>{
    var sender = req.session.user_id;
    var receiver = req.params.id;
    
    var y = await db.query("select * from messages where (sender_id=$1 and receiver_id=$2) or (sender_id=$2 and receiver_id=$1) order by timestamp",[sender, receiver]);
    //console.log(y.rows);
    res.render("chat.ejs", {sender: sender, receiver: receiver, chat_history : y.rows});
});









server.listen(port, ()=>{
    console.log(`http://localhost:${port}`);
});



