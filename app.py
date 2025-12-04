#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Customer Pro Prototyp - Backend
STRIKTE DATENISOLATION: Jeder Außendienst hat eigene isolierte Daten
"""

import os
import base64
import hashlib
import secrets
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, session, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS

# ============================================================
# KONFIGURATION
# ============================================================

app = Flask(__name__, static_folder='.', static_url_path='')

# SICHERHEIT: Secret Key aus Umgebungsvariable oder generieren
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))

# Session-Konfiguration
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # SICHERHEIT: Lax statt None
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('PRODUCTION', 'false').lower() == 'true'
app.config['SESSION_COOKIE_HTTPONLY'] = True  # SICHERHEIT: HttpOnly aktivieren
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=24)
app.config['SESSION_TYPE'] = 'filesystem'

# CORS-Konfiguration - für Production anpassen!
ALLOWED_ORIGINS = os.environ.get('ALLOWED_ORIGINS', '*').split(',')
CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGINS}}, supports_credentials=True, 
     allow_headers=["Content-Type", "Authorization", "X-User-ID", "X-Username"], 
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])

# Datenbank
DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///customer_pro.db')
app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

db = SQLAlchemy(app)


# ============================================================
# FRONTEND ROUTES - HTML/JS AUSLIEFERN
# ============================================================

@app.route('/')
def serve_frontend():
    """Hauptseite ausliefern"""
    return send_file('sales_app.html')

@app.route('/sales_app.js')
def serve_js():
    """JavaScript ausliefern"""
    return send_file('sales_app.js')

@app.route('/favicon.ico')
def favicon():
    """Favicon (optional)"""
    return '', 204


# ============================================================
# SICHERHEITS-HILFSFUNKTIONEN
# ============================================================

def hash_password(password):
    """Sicheres Passwort-Hashing mit Salt"""
    salt = secrets.token_hex(16)
    hash_obj = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
    return f"{salt}${hash_obj.hex()}"

def verify_password(stored_password, provided_password):
    """Passwort-Verifikation"""
    if '$' not in stored_password:
        # Legacy: Klartext-Passwort (für Migration)
        return stored_password == provided_password
    salt, hash_value = stored_password.split('$', 1)
    hash_obj = hashlib.pbkdf2_hmac('sha256', provided_password.encode(), salt.encode(), 100000)
    return hash_obj.hex() == hash_value


# ============================================================
# AUTHENTIFIZIERUNGS-HILFSFUNKTION
# ============================================================

def get_current_user():
    """
    Holt den aktuellen Benutzer aus Session ODER Header.
    Unterstützt sowohl Session-Cookies als auch X-User-ID Header für file:// Zugriff.
    """
    # Zuerst Session prüfen
    user_id = session.get('user_id')
    user_role = session.get('role')
    is_admin = session.get('is_admin')
    
    # Falls keine Session, Header prüfen
    if not user_id:
        header_user_id = request.headers.get('X-User-ID')
        header_username = request.headers.get('X-Username')
        
        if header_user_id and header_username:
            try:
                user = User.query.get(int(header_user_id))
                if user and user.username == header_username:
                    user_id = user.id
                    user_role = user.role
                    is_admin = user.is_admin
                    print(f"[AUTH] Header-Auth für: {user.username}")
            except (ValueError, TypeError):
                pass
    
    return user_id, user_role, is_admin

# ============================================================
# DATENBANKMODELLE
# ============================================================

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)
    role = db.Column(db.String(20), default='Außendienst')
    is_admin = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'role': self.role,
            'is_admin': self.is_admin
        }


class Customer(db.Model):
    __tablename__ = 'customers'
    id = db.Column(db.Integer, primary_key=True)
    customer_number = db.Column(db.String(50), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    address = db.Column(db.String(255))
    phone = db.Column(db.String(50))
    email = db.Column(db.String(120))
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    
    __table_args__ = (
        db.UniqueConstraint('customer_number', 'created_by', name='uq_customer_number_per_user'),
    )
    
    protocols = db.relationship('VisitProtocol', backref='customer', lazy='dynamic', cascade='all, delete-orphan')
    documents = db.relationship('Document', backref='customer', lazy='dynamic',
                               foreign_keys='Document.customer_id', cascade='all, delete-orphan')
    construction_sites = db.relationship('ConstructionSite', backref='customer', lazy='dynamic', cascade='all, delete-orphan')

    def to_dict(self, include_details=False):
        data = {
            'id': self.id,
            'customer_number': self.customer_number,
            'name': self.name,
            'address': self.address,
            'phone': self.phone,
            'email': self.email,
            'created_by': self.created_by
        }
        if include_details:
            data['protocols'] = [p.to_dict() for p in self.protocols.order_by(VisitProtocol.visit_date.desc()).all()]
            data['documents'] = [d.to_dict() for d in self.documents.order_by(Document.created_at.desc()).all()]
            data['construction_sites'] = [s.to_dict() for s in self.construction_sites.all()]
        return data


class VisitProtocol(db.Model):
    __tablename__ = 'visit_protocols'
    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, db.ForeignKey('customers.id'), nullable=False)
    visit_date = db.Column(db.Date, nullable=False)
    summary = db.Column(db.Text, nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    
    def to_dict(self):
        return {
            'id': self.id,
            'customer_id': self.customer_id,
            'visit_date': self.visit_date.strftime('%Y-%m-%d') if self.visit_date else None,
            'summary': self.summary,
            'created_by': self.created_by
        }


class Document(db.Model):
    __tablename__ = 'documents'
    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, db.ForeignKey('customers.id'), nullable=True)
    construction_site_id = db.Column(db.Integer, db.ForeignKey('construction_sites.id'), nullable=True)
    name = db.Column(db.String(255), nullable=False)
    type = db.Column(db.String(50), nullable=False)
    file_url = db.Column(db.String(512), nullable=True)
    file_data = db.Column(db.LargeBinary, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'))

    def to_dict(self):
        return {
            'id': self.id,
            'customer_id': self.customer_id,
            'construction_site_id': self.construction_site_id,
            'name': self.name,
            'type': self.type,
            'file_url': self.file_url or '',
            'has_file': self.file_data is not None,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else '',
            'created_by': self.created_by
        }


class ConstructionSite(db.Model):
    __tablename__ = 'construction_sites'
    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, db.ForeignKey('customers.id'), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    address = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(50), default='Planung')
    start_date = db.Column(db.Date)
    end_date = db.Column(db.Date)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    
    notes = db.relationship('ConstructionNote', backref='construction_site', lazy='dynamic', cascade='all, delete-orphan')
    documents = db.relationship('Document', backref='construction_site', lazy='dynamic',
                               foreign_keys='Document.construction_site_id', cascade='all, delete-orphan')
    
    def to_dict(self, include_details=False):
        data = {
            'id': self.id,
            'customer_id': self.customer_id,
            'name': self.name,
            'address': self.address,
            'status': self.status,
            'start_date': self.start_date.strftime('%Y-%m-%d') if self.start_date else None,
            'end_date': self.end_date.strftime('%Y-%m-%d') if self.end_date else None,
            'created_by': self.created_by
        }
        if include_details:
            data['notes'] = [n.to_dict() for n in self.notes.order_by(ConstructionNote.created_at.desc()).all()]
            data['documents'] = [d.to_dict() for d in self.documents.order_by(Document.created_at.desc()).all()]
        return data


class ConstructionNote(db.Model):
    __tablename__ = 'construction_notes'
    id = db.Column(db.Integer, primary_key=True)
    construction_site_id = db.Column(db.Integer, db.ForeignKey('construction_sites.id'), nullable=False)
    note = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    
    creator = db.relationship('User', foreign_keys=[created_by])
    
    def to_dict(self):
        return {
            'id': self.id,
            'construction_site_id': self.construction_site_id,
            'note': self.note,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else '',
            'created_by': self.creator.username if self.creator else 'Unbekannt'
        }


class TourStop(db.Model):
    __tablename__ = 'tour_stops'
    id = db.Column(db.Integer, primary_key=True)
    tour_id = db.Column(db.Integer, db.ForeignKey('tours.id', ondelete='CASCADE'), nullable=False)
    customer_name = db.Column(db.String(100), nullable=False)
    address = db.Column(db.String(255), nullable=False)
    goal = db.Column(db.Text)
    order = db.Column(db.Integer, nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'customer_name': self.customer_name,
            'address': self.address,
            'goal': self.goal or '',
            'order': self.order
        }


class Tour(db.Model):
    __tablename__ = 'tours'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    archived = db.Column(db.Boolean, default=False)
    completed_at = db.Column(db.DateTime, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    stops = db.relationship('TourStop', backref='tour', lazy='dynamic', cascade='all, delete-orphan')
    creator = db.relationship('User', foreign_keys=[created_by])

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'archived': self.archived,
            'completed_at': self.completed_at.strftime('%Y-%m-%d %H:%M:%S') if self.completed_at else None,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else '',
            'created_by': self.created_by,
            'created_by_name': self.creator.username if self.creator else 'Unbekannt',
            'stops': [s.to_dict() for s in self.stops.order_by(TourStop.order).all()]
        }


# ============================================================
# AUTH ROUTES
# ============================================================

@app.route('/api/auth/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'message': 'Keine Daten'}), 400
            
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        # SICHERHEIT: Benutzer nur nach Username suchen, Passwort separat prüfen
        user = User.query.filter_by(username=username).first()
        
        if user and verify_password(user.password, password):
            session.permanent = True
            session['user_id'] = user.id
            session['username'] = user.username
            session['role'] = user.role
            session['is_admin'] = user.is_admin
            session.modified = True
            print(f"[LOGIN] OK: {user.username} (ID:{user.id}, Rolle:{user.role})")
            return jsonify({'success': True, 'user': user.to_dict()}), 200
        
        print(f"[LOGIN] FEHLGESCHLAGEN für: {username}")
        return jsonify({'success': False, 'message': 'Ungültige Anmeldedaten'}), 401
    except Exception as e:
        print(f"[LOGIN ERROR] {str(e)}")
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    print(f"[LOGOUT] {session.get('username', 'unknown')}")
    session.clear()
    return jsonify({'success': True}), 200


@app.route('/api/auth/check', methods=['GET'])
def check_auth():
    if 'user_id' in session:
        user = User.query.get(session['user_id'])
        if user:
            return jsonify({'authenticated': True, 'user': user.to_dict()}), 200
    return jsonify({'authenticated': False}), 401


# ============================================================
# CUSTOMER ROUTES - STRIKTE DATENISOLATION
# ============================================================

@app.route('/api/customers', methods=['GET'])
def list_customers():
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify([]), 200
    
    try:
        if user_role == 'Außendienst':
            customers = Customer.query.filter_by(created_by=user_id).all()
        else:
            customers = Customer.query.all()
        
        print(f"[CUSTOMERS] User {user_id} ({user_role}): {len(customers)} Kunden")
        return jsonify([c.to_dict() for c in customers]), 200
    except Exception as e:
        print(f"[CUSTOMERS ERROR] {str(e)}")
        return jsonify([]), 200


@app.route('/api/customers/<int:id>', methods=['GET'])
def get_customer(id):
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        customer = Customer.query.get(id)
        if not customer:
            return jsonify({'message': 'Kunde nicht gefunden'}), 404
        
        if user_role == 'Außendienst' and customer.created_by != user_id:
            return jsonify({'message': 'Keine Berechtigung'}), 403
            
        return jsonify(customer.to_dict(include_details=True)), 200
    except Exception as e:
        print(f"[CUSTOMER ERROR] {str(e)}")
        return jsonify({'message': str(e)}), 500


@app.route('/api/customers', methods=['POST'])
def add_customer():
    user_id, user_role, is_admin = get_current_user()
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Keine Daten'}), 400
            
        customer_number = data.get('customer_number', '').strip()
        name = data.get('name', '').strip()
        
        if not customer_number or not name:
            return jsonify({'message': 'Kundennummer und Name sind erforderlich'}), 400

        existing = Customer.query.filter_by(customer_number=customer_number, created_by=user_id).first()
        if existing:
            return jsonify({'message': 'Kundennummer existiert bereits'}), 409

        new_customer = Customer(
            customer_number=customer_number,
            name=name,
            address=data.get('address', '').strip() if data.get('address') else '',
            phone=data.get('phone', '').strip() if data.get('phone') else '',
            email=data.get('email', '').strip() if data.get('email') else '',
            created_by=user_id
        )
        db.session.add(new_customer)
        db.session.commit()
        
        print(f"[CUSTOMER] Erstellt: {new_customer.id} von User {user_id}")
        return jsonify(new_customer.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        print(f"[CUSTOMER CREATE ERROR] {str(e)}")
        return jsonify({'message': str(e)}), 500


@app.route('/api/customers/<int:id>', methods=['PUT'])
def update_customer(id):
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        customer = Customer.query.get(id)
        if not customer:
            return jsonify({'message': 'Kunde nicht gefunden'}), 404
        
        if user_role == 'Außendienst' and customer.created_by != user_id:
            return jsonify({'message': 'Keine Berechtigung'}), 403

        data = request.get_json()
        
        new_number = data.get('customer_number', '').strip()
        if new_number and new_number != customer.customer_number:
            existing = Customer.query.filter_by(customer_number=new_number, created_by=customer.created_by).first()
            if existing:
                return jsonify({'message': 'Kundennummer existiert bereits'}), 409
            customer.customer_number = new_number

        if data.get('name'):
            customer.name = data['name'].strip()
        if 'address' in data:
            customer.address = data['address'].strip() if data['address'] else ''
        if 'phone' in data:
            customer.phone = data['phone'].strip() if data['phone'] else ''
        if 'email' in data:
            customer.email = data['email'].strip() if data['email'] else ''
            
        db.session.commit()
        return jsonify(customer.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 500


@app.route('/api/customers/<int:id>', methods=['DELETE'])
def delete_customer(id):
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        customer = Customer.query.get(id)
        if not customer:
            return jsonify({'message': 'Kunde nicht gefunden'}), 404
        
        if user_role == 'Außendienst' and customer.created_by != user_id:
            return jsonify({'message': 'Keine Berechtigung'}), 403
        
        db.session.delete(customer)
        db.session.commit()
        return jsonify({'message': 'Kunde gelöscht'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 500


# ============================================================
# PROTOCOL ROUTES
# ============================================================

@app.route('/api/protocols', methods=['POST'])
def add_protocol():
    user_id, user_role, is_admin = get_current_user()
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        data = request.get_json()
        new_protocol = VisitProtocol(
            customer_id=data['customer_id'],
            visit_date=datetime.strptime(data['visit_date'], '%Y-%m-%d').date(),
            summary=data['summary'],
            created_by=user_id
        )
        db.session.add(new_protocol)
        db.session.commit()
        return jsonify(new_protocol.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 400


@app.route('/api/protocols/<int:id>', methods=['DELETE'])
def delete_protocol(id):
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        protocol = VisitProtocol.query.get(id)
        if not protocol:
            return jsonify({'message': 'Protokoll nicht gefunden'}), 404
        
        if user_role == 'Außendienst' and protocol.created_by != user_id:
            return jsonify({'message': 'Keine Berechtigung'}), 403
        
        db.session.delete(protocol)
        db.session.commit()
        return jsonify({'message': 'Protokoll gelöscht'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 500


# ============================================================
# DOCUMENT ROUTES
# ============================================================

@app.route('/api/documents', methods=['POST'])
def add_document():
    user_id, user_role, is_admin = get_current_user()
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        data = request.get_json()
        
        new_document = Document(
            customer_id=data.get('customer_id'),
            construction_site_id=data.get('construction_site_id'),
            name=data['name'],
            type=data['type'],
            file_url=data.get('file_url', ''),
            created_by=user_id
        )
        
        if data.get('file_data'):
            file_data_str = data['file_data']
            if ',' in file_data_str:
                file_data_str = file_data_str.split(',')[1]
            new_document.file_data = base64.b64decode(file_data_str)
        
        db.session.add(new_document)
        db.session.commit()
        
        print(f"[DOCUMENT] Erstellt: {new_document.name} (ID:{new_document.id})")
        return jsonify(new_document.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        print(f"[DOCUMENT ERROR] {str(e)}")
        return jsonify({'message': str(e)}), 400


@app.route('/api/documents/<int:id>', methods=['DELETE'])
def delete_document(id):
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        document = Document.query.get(id)
        if not document:
            return jsonify({'message': 'Dokument nicht gefunden'}), 404
        
        if user_role == 'Außendienst' and document.created_by != user_id:
            return jsonify({'message': 'Keine Berechtigung'}), 403
        
        db.session.delete(document)
        db.session.commit()
        return jsonify({'message': 'Dokument gelöscht'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 500


@app.route('/api/documents/<int:id>/download', methods=['GET'])
def download_document(id):
    try:
        document = Document.query.get(id)
        if not document or not document.file_data:
            return jsonify({'message': 'Dokument nicht gefunden'}), 404
        
        return jsonify({
            'name': document.name,
            'type': document.type,
            'data': base64.b64encode(document.file_data).decode('utf-8')
        }), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


# ============================================================
# CONSTRUCTION SITE ROUTES - STRIKTE ISOLATION
# ============================================================

@app.route('/api/constructionsites', methods=['GET'])
def list_sites():
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify([]), 200
    
    try:
        if user_role == 'Außendienst':
            sites = ConstructionSite.query.filter_by(created_by=user_id).all()
        else:
            sites = ConstructionSite.query.all()
        
        print(f"[SITES] User {user_id} ({user_role}): {len(sites)} Baustellen")
        return jsonify([s.to_dict() for s in sites]), 200
    except Exception as e:
        return jsonify([]), 200


@app.route('/api/constructionsites/<int:id>', methods=['GET'])
def get_site(id):
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        site = ConstructionSite.query.get(id)
        if not site:
            return jsonify({'message': 'Baustelle nicht gefunden'}), 404
        
        if user_role == 'Außendienst' and site.created_by != user_id:
            return jsonify({'message': 'Keine Berechtigung'}), 403
            
        return jsonify(site.to_dict(include_details=True)), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@app.route('/api/constructionsites', methods=['POST'])
def add_site():
    user_id, user_role, is_admin = get_current_user()
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        data = request.get_json()
        
        start_date = None
        end_date = None
        if data.get('start_date'):
            start_date = datetime.strptime(data['start_date'], '%Y-%m-%d').date()
        if data.get('end_date'):
            end_date = datetime.strptime(data['end_date'], '%Y-%m-%d').date()
        
        new_site = ConstructionSite(
            customer_id=data['customer_id'],
            name=data['name'],
            address=data['address'],
            status=data.get('status', 'Planung'),
            start_date=start_date,
            end_date=end_date,
            created_by=user_id
        )
        db.session.add(new_site)
        db.session.commit()
        return jsonify(new_site.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 400


@app.route('/api/constructionsites/<int:id>', methods=['PUT'])
def update_site(id):
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        site = ConstructionSite.query.get(id)
        if not site:
            return jsonify({'message': 'Baustelle nicht gefunden'}), 404
        
        if user_role == 'Außendienst' and site.created_by != user_id:
            return jsonify({'message': 'Keine Berechtigung'}), 403

        data = request.get_json()
        
        if data.get('name'):
            site.name = data['name']
        if data.get('address'):
            site.address = data['address']
        if data.get('status'):
            site.status = data['status']
        if data.get('start_date'):
            site.start_date = datetime.strptime(data['start_date'], '%Y-%m-%d').date()
        if data.get('end_date'):
            site.end_date = datetime.strptime(data['end_date'], '%Y-%m-%d').date()
            
        db.session.commit()
        return jsonify(site.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 500


@app.route('/api/constructionsites/<int:id>', methods=['DELETE'])
def delete_site(id):
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        site = ConstructionSite.query.get(id)
        if not site:
            return jsonify({'message': 'Baustelle nicht gefunden'}), 404
        
        if user_role == 'Außendienst' and site.created_by != user_id:
            return jsonify({'message': 'Keine Berechtigung'}), 403
            
        db.session.delete(site)
        db.session.commit()
        return jsonify({'message': 'Baustelle gelöscht'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 500


# ============================================================
# CONSTRUCTION NOTES ROUTES
# ============================================================

@app.route('/api/constructionsites/<int:site_id>/notes', methods=['POST'])
def add_construction_note(site_id):
    user_id, user_role, is_admin = get_current_user()
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        data = request.get_json()
        new_note = ConstructionNote(
            construction_site_id=site_id,
            note=data['note'],
            created_by=user_id
        )
        db.session.add(new_note)
        db.session.commit()
        return jsonify(new_note.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 400


@app.route('/api/constructionnotes/<int:id>', methods=['DELETE'])
def delete_construction_note(id):
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        note = ConstructionNote.query.get(id)
        if not note:
            return jsonify({'message': 'Notiz nicht gefunden'}), 404
        
        if user_role == 'Außendienst' and note.created_by != user_id:
            return jsonify({'message': 'Keine Berechtigung'}), 403
        
        db.session.delete(note)
        db.session.commit()
        return jsonify({'message': 'Notiz gelöscht'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 500


# ============================================================
# TOUR ROUTES - STRIKTE ISOLATION
# ============================================================

@app.route('/api/tours', methods=['GET'])
def list_tours():
    archived = request.args.get('archived', 'false').lower() == 'true'
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify([]), 200
    
    try:
        if user_role == 'Außendienst':
            tours = Tour.query.filter_by(archived=archived, created_by=user_id).all()
        else:
            tours = Tour.query.filter_by(archived=archived).all()
        
        print(f"[TOURS] User {user_id}: {len(tours)} (archived={archived})")
        return jsonify([t.to_dict() for t in tours]), 200
    except Exception as e:
        return jsonify([]), 200


@app.route('/api/tours', methods=['POST'])
def add_tour():
    user_id, user_role, is_admin = get_current_user()
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        data = request.get_json()
        
        if not data or not data.get('title') or not data.get('stops'):
            return jsonify({'message': 'Titel und Stopps erforderlich'}), 400
            
        tour = Tour(title=data['title'], created_by=user_id)
        db.session.add(tour)
        db.session.flush()
        
        for idx, stop_data in enumerate(data['stops']):
            stop = TourStop(
                tour_id=tour.id,
                customer_name=stop_data['customer_name'],
                address=stop_data['address'],
                goal=stop_data.get('goal', ''),
                order=idx + 1
            )
            db.session.add(stop)
        
        db.session.commit()
        print(f"[TOUR] Erstellt: {tour.id} von User {user_id}")
        return jsonify(tour.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        print(f"[TOUR ERROR] {str(e)}")
        return jsonify({'message': str(e)}), 400


@app.route('/api/tours/<int:id>/complete', methods=['POST'])
def complete_tour(id):
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        tour = Tour.query.get(id)
        if not tour:
            return jsonify({'message': 'Tour nicht gefunden'}), 404
        
        if user_role == 'Außendienst' and tour.created_by != user_id:
            return jsonify({'message': 'Keine Berechtigung'}), 403
        
        tour.archived = True
        tour.completed_at = datetime.utcnow()
        db.session.commit()
        return jsonify(tour.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 500


@app.route('/api/tours/<int:id>', methods=['DELETE'])
def delete_tour(id):
    user_id, user_role, is_admin = get_current_user()
    
    if not user_id:
        return jsonify({'message': 'Nicht angemeldet'}), 401
    
    try:
        tour = Tour.query.get(id)
        if not tour:
            return jsonify({'message': 'Tour nicht gefunden'}), 404
        
        if user_role == 'Außendienst' and tour.created_by != user_id:
            return jsonify({'message': 'Keine Berechtigung'}), 403
            
        db.session.delete(tour)
        db.session.commit()
        return jsonify({'message': 'Tour gelöscht'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 500


# ============================================================
# INNENDIENST SPEZIAL-ENDPOINT
# ============================================================

@app.route('/api/users/aussendienst/<int:target_user_id>/data', methods=['GET'])
def get_aussendienst_data(target_user_id):
    """Innendienst: Lädt ALLE Daten eines Außendienst-Mitarbeiters"""
    current_user_id, user_role, is_admin = get_current_user()
    # KORREKTUR: Die Zeile 'current_role = session.get('role')' wurde entfernt,
    # da sie den korrekten user_role-Wert (aus dem Header) überschreiben würde.
    
    # Graceful: Bei fehlender Anmeldung leere Daten zurückgeben
    if not current_user_id:
        return jsonify({
            'user': {},
            'customers': [],
            'active_tours': [],
            'archived_tours': [],
            'construction_sites': []
        }), 200
    
    # Nur Innendienst oder Admin dürfen zugreifen
    if user_role != 'Innendienst' and not is_admin:
        return jsonify({
            'user': {},
            'customers': [],
            'active_tours': [],
            'archived_tours': [],
            'construction_sites': []
        }), 200
    
    try:
        target_user = User.query.get(target_user_id)
        if not target_user:
            return jsonify({
                'user': {},
                'customers': [],
                'active_tours': [],
                'archived_tours': [],
                'construction_sites': []
            }), 200
        
        customers = Customer.query.filter_by(created_by=target_user_id).all()
        active_tours = Tour.query.filter_by(created_by=target_user_id, archived=False).all()
        archived_tours = Tour.query.filter_by(created_by=target_user_id, archived=True).all()
        construction_sites = ConstructionSite.query.filter_by(created_by=target_user_id).all()
        
        print(f"[INNENDIENST] Daten für {target_user.username}: {len(customers)} Kunden, {len(active_tours)} aktive, {len(archived_tours)} archiviert, {len(construction_sites)} Baustellen")
        
        return jsonify({
            'user': target_user.to_dict(),
            'customers': [c.to_dict() for c in customers],
            'active_tours': [t.to_dict() for t in active_tours],
            'archived_tours': [t.to_dict() for t in archived_tours],
            'construction_sites': [s.to_dict() for s in construction_sites]
        }), 200
    except Exception as e:
        print(f"[INNENDIENST ERROR] {str(e)}")
        return jsonify({
            'user': {},
            'customers': [],
            'active_tours': [],
            'archived_tours': [],
            'construction_sites': []
        }), 200


# ============================================================
# USER ROUTES
# ============================================================

@app.route('/api/users', methods=['GET'])
def list_users():
    try:
        users = User.query.all()
        return jsonify([u.to_dict() for u in users]), 200
    except Exception as e:
        return jsonify([]), 200


@app.route('/api/users', methods=['POST'])
def create_user():
    try:
        data = request.get_json()
        
        if not data.get('username') or not data.get('password'):
            return jsonify({'message': 'Nutzername und Passwort erforderlich'}), 400
        
        if User.query.filter_by(username=data['username']).first():
            return jsonify({'message': 'Nutzername existiert bereits'}), 409
            
        new_user = User(
            username=data['username'],
            password=data['password'],
            role=data.get('role', 'Außendienst'),
            is_admin=data.get('is_admin', False)
        )
        db.session.add(new_user)
        db.session.commit()
        return jsonify(new_user.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 500


@app.route('/api/users/<int:id>', methods=['DELETE'])
def delete_user(id):
    try:
        user = User.query.get(id)
        if not user:
            return jsonify({'message': 'Nutzer nicht gefunden'}), 404
        if user.id == 1:
            return jsonify({'message': 'System-Admin kann nicht gelöscht werden'}), 403
        db.session.delete(user)
        db.session.commit()
        return jsonify({'message': 'Nutzer gelöscht'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': str(e)}), 500


# ============================================================
# INITIALISIERUNG
# ============================================================

def init_database():
    with app.app_context():
        # NUR Tabellen erstellen - NICHT löschen!
        db.create_all()
        
        # Prüfen ob bereits Benutzer existieren
        existing_users = User.query.count()
        if existing_users > 0:
            print(f"[DB] {existing_users} Benutzer existieren bereits - überspringe Initialisierung")
            return
        
        print("[DB] Keine Benutzer gefunden - erstelle Testdaten...")
        
        # Benutzer erstellen
        admin = User(username='admin', password='42', role='Außendienst', is_admin=True)
        paul = User(username='paul', password='paul123', role='Außendienst', is_admin=False)
        thomas = User(username='thomas', password='thomas123', role='Außendienst', is_admin=False)
        maria = User(username='maria', password='maria123', role='Innendienst', is_admin=False)
        
        db.session.add_all([admin, paul, thomas, maria])
        db.session.commit()
        
        # PAUL Testdaten (ID 2)
        paul_k1 = Customer(customer_number='P001', name='Pauls Kunde GmbH',
                          address='Paulstraße 1, 10115 Berlin', phone='+49 30 111222',
                          email='kontakt@paulskunde.de', created_by=paul.id)
        paul_k2 = Customer(customer_number='P002', name='Paul Consulting AG',
                          address='Paulweg 5, 80331 München', phone='+49 89 333444',
                          email='info@paulconsulting.de', created_by=paul.id)
        db.session.add_all([paul_k1, paul_k2])
        db.session.flush()
        
        paul_site = ConstructionSite(customer_id=paul_k1.id, name='Pauls Baustelle Berlin',
                                    address='Paulstraße 1, 10115 Berlin', status='Aktiv',
                                    start_date=datetime(2025,1,1).date(), created_by=paul.id)
        db.session.add(paul_site)
        
        paul_tour = Tour(title='Pauls Montags-Tour', created_by=paul.id)
        db.session.add(paul_tour)
        db.session.flush()
        db.session.add(TourStop(tour_id=paul_tour.id, customer_name='Pauls Kunde GmbH',
                               address='Paulstraße 1, Berlin', goal='Beratung', order=1))
        
        paul_arch = Tour(title='Pauls alte Tour', created_by=paul.id, archived=True,
                        completed_at=datetime(2025,1,10))
        db.session.add(paul_arch)
        db.session.flush()
        db.session.add(TourStop(tour_id=paul_arch.id, customer_name='Alter Kunde',
                               address='Alte Str 1', goal='Abschluss', order=1))
        
        # THOMAS Testdaten (ID 3)
        thomas_k1 = Customer(customer_number='T001', name='Thomas Tech Solutions',
                            address='Thomasstraße 10, 20095 Hamburg', phone='+49 40 555666',
                            email='info@thomastech.de', created_by=thomas.id)
        thomas_k2 = Customer(customer_number='T002', name='Thomas Bau KG',
                            address='Thomasallee 20, 50667 Köln', phone='+49 221 777888',
                            email='kontakt@thomasbau.de', created_by=thomas.id)
        db.session.add_all([thomas_k1, thomas_k2])
        db.session.flush()
        
        thomas_site = ConstructionSite(customer_id=thomas_k1.id, name='Thomas Projekt Hamburg',
                                      address='Thomasstraße 10, Hamburg', status='Planung',
                                      start_date=datetime(2025,3,1).date(), created_by=thomas.id)
        db.session.add(thomas_site)
        
        thomas_tour = Tour(title='Thomas Wochentour', created_by=thomas.id)
        db.session.add(thomas_tour)
        db.session.flush()
        db.session.add(TourStop(tour_id=thomas_tour.id, customer_name='Thomas Tech Solutions',
                               address='Thomasstraße 10, Hamburg', goal='Präsentation', order=1))
        
        thomas_arch = Tour(title='Thomas alte Tour', created_by=thomas.id, archived=True,
                          completed_at=datetime(2025,1,15))
        db.session.add(thomas_arch)
        db.session.flush()
        db.session.add(TourStop(tour_id=thomas_arch.id, customer_name='Alter Kunde',
                               address='Alte Str 1', goal='Abschluss', order=1))
        
        db.session.commit()
        
        print("\n" + "="*60)
        print("CUSTOMER PRO PROTOTYP - DATENBANK INITIALISIERT")
        print("="*60)
        print("BENUTZER:")
        print("  admin / 42        (Außendienst + Admin)")
        print("  paul / paul123    (Außendienst, ID 2)")
        print("  thomas / thomas123 (Außendienst, ID 3)")
        print("  maria / maria123  (Innendienst)")
        print("="*60)
        print(f"Paul: 2 Kunden, 1 Baustelle, 2 Touren")
        print(f"Thomas: 2 Kunden, 1 Baustelle, 2 Touren")
        print("="*60 + "\n")


# ============================================================
# AUTOMATISCHE DATENBANK-INITIALISIERUNG BEIM START
# ============================================================

def auto_init_database():
    """Prüft ob Tabellen existieren, wenn nicht -> erstellen"""
    with app.app_context():
        try:
            # Versuche einen User abzufragen
            User.query.first()
            print("[DB] Datenbank existiert bereits")
        except:
            # Tabellen existieren nicht -> erstellen
            print("[DB] Erstelle Datenbank...")
            init_database()

# Diese Zeile wird beim Import/Start ausgeführt
auto_init_database()


if __name__ == '__main__':
    print("Server läuft auf: http://127.0.0.1:5001")
    app.run(debug=True, port=5001)
