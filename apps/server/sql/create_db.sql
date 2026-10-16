CREATE DATABASE "modelfleet" WITH ENCODING 'UTF8';

CREATE USER "modelfleet" WITH ENCRYPTED PASSWORD 'modelfleet';

GRANT CONNECT ON DATABASE "modelfleet" TO "modelfleet";

-- \c modelfleet

GRANT ALL ON SCHEMA public TO "modelfleet";
