-- Dữ liệu mẫu cho môi trường phát triển. KHÔNG dùng dữ liệu thật của học sinh ở đây.
-- Cách dùng: tạo trước 2 tài khoản trong Supabase Auth (một giáo viên, một học sinh),
-- rồi thay hai UUID bên dưới bằng id thật và chạy file này.

-- update public.profiles set role = 'teacher', full_name = 'Giáo viên thử nghiệm' where id = '<TEACHER_UUID>';

-- insert into public.students (teacher_id, profile_id, full_name, grade, goals)
-- values ('<TEACHER_UUID>', '<STUDENT_UUID>', 'Học sinh thử nghiệm', '9', 'Ôn thi vào lớp 10');

-- insert into public.sessions (teacher_id, student_id, subject, topic, scheduled_start, scheduled_end)
-- select '<TEACHER_UUID>', id, 'Toán', 'Hệ phương trình', now() + interval '1 hour', now() + interval '2 hours'
-- from public.students where profile_id = '<STUDENT_UUID>';
