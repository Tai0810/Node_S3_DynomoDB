const express = require('express');
const PORT = 3000;
const app = express();
let courses = require('./data');

const multer = require("multer");
const AWS = require("aws-sdk");
require("dotenv").config();
const path = require("path");
const { errorMonitor } = require('stream');

process.env.AWS_SDK_SUPPRESS_MAINTENANCE_MODE_MESSAGE = "1";

// Cấu hình aws sdk để truy cập vào Cloud Aws thông qua tài khỏa IAM User
AWS.config.update({
    region: process.env.REGION,
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
});

const s3 = new AWS.S3();
const dynomoDB = new AWS.DynamoDB.DocumentClient();

const bucketName = process.env.S3_BUCKET_NAME;
const tableName = process.env.DYNOMODB_TABLE_NAME;

// Cấu hình multer quản lý upload image
const storage = multer.memoryStorage({
    destination(req, file, callback) {
        callback(null, "");
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 2000000 }, // Chỉ cho phép tối đa là 2MB
    fileFilter(req, file, cb) {
        checkFileType(file, cb);
    },
});

function checkFileType(file, cb) {
    const fileType = /jpeg|jpg|png|gif/;

    const extname = fileType.test(path.extname(file.originalname).toLowerCase());
    const mimetype = fileType.test(file.mimetype);
    if (extname && mimetype) {
        return cb(null, true);
    }
    return cb("Error: Pls upload images /jpeg|jpg|png|gif/ only!");
}

//register middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static('./views')); // Cho phép dùng các tài nguyên như css, javascrips, images,...

//config view
app.set('view engine', 'ejs'); // Khai báo rằng app sẽ dùng engine EJS để render trang web
app.set('views', './views'); // Nội dung render trang web sẽ nằm trong thư mục tên views

// app.get('/', (req, resp) =>{
//     return resp.render('index', {courses}) // Send data to ejs
// });

app.get('/', async (req, resp) => {
    try {
        const params = { TableName: tableName };
        const data = await dynomoDB.scan(params).promise(); // Dùng hàm scan để lấy toàn bộ dữ liệu trong table DynomoDB
        console.log("data=", data.Items);
        return resp.render("index.ejs", { data: data.Items }); // Dùng biến rép để render trang index.ejs đồng thời truyền biến data
    } catch (error) {
        console.error("Error retrieving data from DynomoDB:", error);
        return resp.status(500).send("Internal Server Error");
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// app.post('/save', (req, resp) => {
//     const id = Number(req.body.id);
//     const name = req.body.name;
//     const course_type = req.body.course_type;
//     const semester = req.body.semester;
//     const department = req.body.department;

//     const params = {
//         'id': id,
//         "name": name,
//         "course_type": course_type,
//         "semester": semester,
//         "department": department
//     }

//     courses.push(params);

//     return resp.redirect('/');
// });

app.post('/save', upload.single("image"), (req, resp) => {
    // Middleware uploadsingle('image') chỉnh đình rằng field có name 'image' trong request sẽ được xử lý(lọc,...)
    try {
        const id = Number(req.body.id);
        const name = req.body.name;
        const course_type = req.body.course_type;
        const semester = req.body.semester;
        const department = req.body.department;

        const image = req.file?.originalname.split(".");
        const fileType = image[image.length - 1];
        const filePath = `${id}_${Date.now().toString()}.${fileType}`; // Đặt tên cho hình ảnh sẽ lưu trong s3

        const paramsS3 = {
            Bucket: bucketName,
            Key: filePath,
            Body: req.file.buffer,
            ContentType: req.file.mimetypem
        };

        s3.upload(paramsS3, async (err, data) => { // Upload ảnh lên S3 trước
            if(err){
                console.error("error=". err);
                return resp.send("Internal server error!");
            } else { // Khi upload s3 thành công
                const imageURL = data.Location; // Gán URL S3 trả về vào field trong table DynomoDB
                const paramsDynomoDB = {
                    TableName: tableName,
                    Irem: {
                        id: Number(id),
                        name: name,
                        course_type: course_type,
                        semester: semester,
                        department: department,
                        image: imageURL,
                    },
                };

                await dynomoDB.put(paramsDynomoDB).promise();
                return resp.redirect("/"); //Render lại trang index để cập nhật dữ liệu table
            }
        });
    } catch (error) {
        console.error("Error saving data from DynomoDB:", error);
        return resp.status(500).send("Internal Server Error")
    }
});

// app.post('/delete', (req, resp) => {
//     const listCheckboxSelected = Object.keys(req.body); // Lấy ra tất cả checkboxs
//     //req.body trả về 1 object chứa các cặp key & value định dạng
//     // '123456': on,
//     // '123458': on,
//     //listCheckboxSelected trả về 1 array: [ '123456', '123458', '123212' ]
//     if (listCheckboxSelected.length <= 0) {
//         return resp.redirect('/');
//     }

//     function onDeleteItem(length) { // Định nghĩa hàm đệ quy xóa
//         const maMonHocCanXoa = Number(listCheckboxSelected[length]); // Lấy ra maMonHoc cần xóa

//         data = data.filter(item => item.maMonHoc !== maMonHocCanXoa); // Dùng hàm filter hoặc .split hoặc nhiều cách khác để xóa mảng
//         if (length < 0) {
//             console.log('Data deleted: ', JSON.stringify(data));
//             onDeleteItem(length - 1);
//         } else // Nếu length = 0 tức là không còn gì trong listCheckbox để xóa -> Render lại trang index để cập nhật data.
//             return resp.redirect('/');
//     }
//     onDeleteItem(listCheckboxSelected.length - 1); //Gọi hàm đệ quy
// })

app.post('/delete', upload.fields([]), (req, resp) => {
    const listCheckboxSelected = Object.keys(req.body); // Lấy ra tất cả checkboxs
    //req.body trả về 1 object chứa các cặp key & value định dạng
    // '123456': on,
    // '123458': on,
    //listCheckboxSelected trả về 1 array: [ '123456', '123458', '123212' ]
    if (!listCheckboxSelected || listCheckboxSelected.length <= 0) {
        return resp.redirect('/');
    }

    try {
        function onDeleteItem(length) { // Định nghĩa hàm đệ quy xóa

            const params = {
                TableName: tableName,
                Key: {
                    id: Number(listCheckboxSelected[length]),
                },
            };

            dynomoDB.delete(params, (err, data) => { // Dùng hàm .delete của aws-sdk
                if(err){
                    console.error("error=", err);
                    return resp.send("Internal Server Error!");
                } else if (length > 0) onDeleteItem(length - 1) // Nếu vị trí cần xóa vẫn > 0 thì gọi đệ quy xóa tiếp
                else return resp.redirect("/"); // Render lại trang index.ejs để cập nhật dữ liệu table
            });
        }
        onDeleteItem(listCheckboxSelected.length - 1); //Gọi hàm đệ quy
    } catch (error) {
        console.error("Error deleting data from DynomoDB:", error);
        return resp.status(500).send("Internal Server Error")
    }
})