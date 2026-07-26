-- =====================================================================
-- PERMISOS DE USUARIO ADMINISTRADOR / SUPERVISOR (OWNER ROLE)
-- Usuario: Braejan David Arias Heregua (braejan@witsaba.com)
-- =====================================================================

-- Insertar o actualizar el perfil de Braejan en la tabla `profiles` con rol 'supervisor' (Owner Level)
INSERT INTO profiles (
    id,
    email,
    full_name,
    role,
    is_active,
    created_at,
    updated_at
) VALUES (
    gen_random_uuid(),
    'braejan@witsaba.com',
    'Braejan David Arias Heregua',
    'supervisor',
    true,
    NOW(),
    NOW()
)
ON CONFLICT (email) 
DO UPDATE SET 
    role = 'supervisor',
    is_active = true,
    updated_at = NOW();

-- Conceder permisos de administración total sobre la gestión de planes y políticas RLS
COMMENT ON TABLE profiles IS 'Braejan David Arias Heregua (braejan@witsaba.com) asignado con rol Supervisor / Owner con permisos globales de administración de planes, auditorías y gestión de usuarios.';
